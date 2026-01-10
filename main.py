import os
import io
import sqlite3
import fitz  # PyMuPDF
from collections import Counter
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import traceback

app = FastAPI(title="DocuClean - PDF Watermark Remover")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup
DB_FILE = "analytics.db"

def init_database():
    """Initialize SQLite database for analytics"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
   
    # Events table (existing)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            file_size INTEGER,
            file_extension TEXT,
            user_agent TEXT,
            ip_address TEXT
        )
    """)
   
    # NEW: Users table for tracking user-level data including feedback
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            session_id TEXT PRIMARY KEY,
            visit_count INTEGER DEFAULT 0,
            upload_count INTEGER DEFAULT 0,
            download_count INTEGER DEFAULT 0,
            first_seen TEXT,
            last_seen TEXT,
            reaction TEXT,
            email TEXT,
            feedback_timestamp TEXT
        )
    """)
   
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_session_id ON analytics(session_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_event_type ON analytics(event_type)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_timestamp ON analytics(timestamp)
    """)
   
    conn.commit()
    conn.close()
    print("✅ Database initialized successfully")

init_database()

# Pydantic models
class AnalyticsEvent(BaseModel):
    session_id: str
    event_type: str
    timestamp: str
    file_size: Optional[int] = None
    file_name: Optional[str] = None
    reaction: Optional[str] = None
    email: Optional[str] = None

class AnalyticsStats(BaseModel):
    unique_visitors: int
    total_uploads: int
    total_downloads: int
    total_events: int

class AdminStats(BaseModel):
    unique_users: int
    repeat_users: int
    total_uploads: int
    total_downloads: int
    page_visits: int

# Analytics functions
def update_user_record(session_id: str, event_type: str, timestamp: str, reaction: str = None, email: str = None):
    """Update or create user record in users table"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Check if user exists
        cursor.execute("SELECT * FROM users WHERE session_id = ?", (session_id,))
        user = cursor.fetchone()
        
        if user is None:
            # Create new user
            cursor.execute("""
                INSERT INTO users (session_id, visit_count, upload_count, download_count, first_seen, last_seen)
                VALUES (?, 0, 0, 0, ?, ?)
            """, (session_id, timestamp, timestamp))
        
        # Update counts based on event type
        if event_type == 'page_visit':
            cursor.execute("""
                UPDATE users 
                SET visit_count = visit_count + 1, last_seen = ?
                WHERE session_id = ?
            """, (timestamp, session_id))
        elif event_type == 'file_upload':
            cursor.execute("""
                UPDATE users 
                SET upload_count = upload_count + 1, last_seen = ?
                WHERE session_id = ?
            """, (timestamp, session_id))
        elif event_type == 'file_download':
            cursor.execute("""
                UPDATE users 
                SET download_count = download_count + 1, last_seen = ?
                WHERE session_id = ?
            """, (timestamp, session_id))
        elif event_type.startswith('reaction_'):
            # Store the reaction (love, good, okay)
            reaction_value = event_type.replace('reaction_', '')
            cursor.execute("""
                UPDATE users 
                SET reaction = ?, feedback_timestamp = ?, last_seen = ?
                WHERE session_id = ?
            """, (reaction_value, timestamp, timestamp, session_id))
        elif event_type == 'email_pdf_requested' and email:
            # Store the email
            cursor.execute("""
                UPDATE users 
                SET email = ?, last_seen = ?
                WHERE session_id = ?
            """, (email, timestamp, session_id))
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error updating user record: {e}")

def track_analytics_event(event: AnalyticsEvent, request: Request):
    """Store analytics event in database"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
       
        user_agent = request.headers.get("user-agent", "")
        ip_address = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        if "," in ip_address:
            ip_address = ip_address.split(",")[0].strip()
       
        # Store in events table
        cursor.execute("""
            INSERT INTO analytics (session_id, event_type, timestamp, file_size, file_extension, user_agent, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            event.session_id,
            event.event_type,
            event.timestamp,
            event.file_size,
            event.file_name,
            user_agent,
            ip_address
        ))
       
        conn.commit()
        conn.close()
        
        # Update user record
        update_user_record(event.session_id, event.event_type, event.timestamp, event.reaction, event.email)
        
    except Exception as e:
        print(f"Analytics error: {e}")

def get_analytics_stats() -> AnalyticsStats:
    """Get current analytics statistics"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
   
    # Count unique users from users table
    cursor.execute("SELECT COUNT(*) FROM users")
    unique_visitors = cursor.fetchone()[0]
   
    cursor.execute("SELECT SUM(upload_count) FROM users")
    total_uploads = cursor.fetchone()[0] or 0
   
    cursor.execute("SELECT SUM(download_count) FROM users")
    total_downloads = cursor.fetchone()[0] or 0
   
    cursor.execute("SELECT COUNT(*) FROM analytics")
    total_events = cursor.fetchone()[0]
   
    conn.close()
   
    return AnalyticsStats(
        unique_visitors=unique_visitors,
        total_uploads=total_uploads,
        total_downloads=total_downloads,
        total_events=total_events
    )

def get_admin_stats() -> AdminStats:
    """Get detailed analytics statistics with proper user classification"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
   
    # Get user counts from users table
    cursor.execute("SELECT COUNT(*) FROM users WHERE visit_count = 1")
    unique_users = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM users WHERE visit_count > 1")
    repeat_users = cursor.fetchone()[0]
   
    cursor.execute("SELECT SUM(upload_count) FROM users")
    total_uploads = cursor.fetchone()[0] or 0
   
    cursor.execute("SELECT SUM(download_count) FROM users")
    total_downloads = cursor.fetchone()[0] or 0
   
    cursor.execute("SELECT SUM(visit_count) FROM users")
    page_visits = cursor.fetchone()[0] or 0
   
    conn.close()
   
    return AdminStats(
        unique_users=unique_users,
        repeat_users=repeat_users,
        total_uploads=total_uploads,
        total_downloads=total_downloads,
        page_visits=page_visits
    )

# PDF Processing Functions
def detect_watermark_candidates(file_bytes):
    """Detect repetitive text across PDF pages"""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page_limit = min(5, len(doc))
        text_counts = Counter()

        for i in range(page_limit):
            page = doc[i]
            blocks = [b[4].strip() for b in page.get_text("blocks") if len(b[4].strip()) > 3]
            text_counts.update(blocks)

        threshold = max(2, page_limit - 1)
        candidates = [t for t, c in text_counts.items() if c >= threshold]
        doc.close()
        return candidates
    except Exception as e:
        print(f"Detection error: {e}")
        traceback.print_exc()
        return []

def clean_page_logic(page, header_h, footer_h, keywords, match_case=False):
    """Clean a single page by removing keywords and masking margins"""
    try:
        if keywords:
            for keyword in keywords:
                if not keyword:
                    continue
                for quad in page.search_for(keyword):
                    if match_case:
                        txt = page.get_text("text", clip=quad)
                        if keyword not in txt:
                            continue
                    page.add_redact_annot(quad, fill=None)
            page.apply_redactions()

        rect = page.rect
        clip = fitz.Rect(0, rect.height - 10, 1, rect.height - 9)
        pix = page.get_pixmap(clip=clip)
        r, g, b = pix.pixel(0, 0)
        bg = (r / 255, g / 255, b / 255)

        if footer_h > 0:
            page.draw_rect(
                fitz.Rect(0, rect.height - footer_h, rect.width, rect.height),
                color=bg, fill=bg
            )

        if header_h > 0:
            page.draw_rect(
                fitz.Rect(0, 0, rect.width, header_h),
                color=bg, fill=bg
            )
    except Exception as e:
        print(f"Error in clean_page_logic: {e}")
        traceback.print_exc()

def process_pdf_document(file_bytes, keywords, header_h, footer_h, match_case=False):
    """Process entire PDF document"""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        doc.set_metadata({})
       
        for page in doc:
            clean_page_logic(page, header_h, footer_h, keywords, match_case)
       
        out = io.BytesIO()
        doc.save(out)
        doc.close()
        out.seek(0)
        return out.getvalue()
    except Exception as e:
        print(f"Error in process_pdf_document: {str(e)}")
        traceback.print_exc()
        raise

def generate_preview_image(file_bytes, keywords, header_h, footer_h, match_case=False):
    """Generate preview of first page"""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        if len(doc) == 0:
            return None
       
        page = doc[0]
        clean_page_logic(page, header_h, footer_h, keywords, match_case)
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes("png")
        doc.close()
        return img_bytes
    except Exception as e:
        print(f"Preview error: {e}")
        traceback.print_exc()
        return None

# Get paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# API Routes
@app.get("/")
async def serve_index():
    """Serve the frontend HTML"""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail=f"Frontend not found at {index_path}")
    return FileResponse(index_path)

@app.get("/admin")
async def serve_admin():
    """Serve the admin dashboard"""
    admin_path = os.path.join(FRONTEND_DIR, "admin.html")
    if not os.path.exists(admin_path):
        raise HTTPException(status_code=404, detail=f"Admin dashboard not found")
    return FileResponse(admin_path)

@app.post("/analyze")
async def analyze_pdf(file: UploadFile = File(...)):
    """Analyze PDF and detect watermark candidates"""
    try:
        if not file.content_type == "application/pdf" and not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
       
        contents = await file.read()
       
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
       
        max_size = 50 * 1024 * 1024
        if len(contents) > max_size:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
       
        keywords = detect_watermark_candidates(contents)
        return {"keywords": ", ".join(keywords)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Analysis error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to analyze PDF: {str(e)}")

@app.post("/preview")
async def preview_file(
    file: UploadFile = File(...),
    keywords: str = Form(""),
    header_h: int = Form(0),
    footer_h: int = Form(25),
    match_case: bool = Form(False)
):
    """Generate preview of cleaned PDF"""
    try:
        if not file.content_type == "application/pdf" and not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
       
        contents = await file.read()
       
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
       
        max_size = 50 * 1024 * 1024
        if len(contents) > max_size:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
       
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
        preview_bytes = generate_preview_image(contents, kw_list, header_h, footer_h, match_case)
       
        if preview_bytes is None:
            raise HTTPException(status_code=400, detail="Could not generate preview")
       
        return Response(content=preview_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Preview error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {str(e)}")

@app.post("/process")
async def process_file(
    file: UploadFile = File(...),
    keywords: str = Form(""),
    header_h: int = Form(0),
    footer_h: int = Form(25),
    match_case: bool = Form(False)
):
    """Process PDF and return cleaned version"""
    try:
        if not file.content_type == "application/pdf" and not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
       
        contents = await file.read()
       
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
       
        max_size = 50 * 1024 * 1024
        if len(contents) > max_size:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
       
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
        cleaned = process_pdf_document(contents, kw_list, header_h, footer_h, match_case)
       
        filename = file.filename.rsplit('.', 1)[0] if '.' in file.filename else file.filename
       
        return Response(
            content=cleaned,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=Clean_{filename}.pdf"}
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Processing error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

# Analytics Routes
@app.post("/analytics/track")
async def track_event(event: AnalyticsEvent, request: Request):
    """Track analytics event"""
    try:
        track_analytics_event(event, request)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/analytics/stats")
async def get_stats():
    """Get analytics statistics"""
    try:
        return get_analytics_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/admin-stats")
async def get_admin_statistics():
    """Get detailed admin statistics"""
    try:
        return get_admin_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/user-details")
async def get_user_details():
    """Get detailed user activity from users table"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
       
        cursor.execute("""
            SELECT
                session_id,
                visit_count,
                upload_count,
                download_count,
                first_seen,
                last_seen,
                CASE WHEN visit_count > 1 THEN 1 ELSE 0 END as is_repeat,
                reaction,
                email
            FROM users
            ORDER BY last_seen DESC
        """)
       
        rows = cursor.fetchall()
        conn.close()
       
        users = []
        for row in rows:
            users.append({
                "session_id": row[0],
                "visit_count": row[1],
                "upload_count": row[2],
                "download_count": row[3],
                "first_seen": row[4],
                "last_seen": row[5],
                "is_repeat": bool(row[6]),
                "reaction": row[7],
                "email": row[8]
            })
       
        return {"users": users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/recent-activity")
async def get_recent_activity(limit: int = 50):
    """Get recent activity events"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
       
        cursor.execute("""
            SELECT 
                a.session_id,
                a.event_type,
                a.timestamp,
                u.visit_count > 1 as is_repeat
            FROM analytics a
            LEFT JOIN users u ON a.session_id = u.session_id
            ORDER BY a.timestamp DESC
            LIMIT ?
        """, (limit,))
       
        rows = cursor.fetchall()
        conn.close()
       
        activities = []
        for row in rows:
            activities.append({
                "session_id": row[0],
                "event_type": row[1],
                "timestamp": row[2],
                "is_repeat": bool(row[3])
            })
       
        return {"activities": activities}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/export-csv")
async def export_csv():
    """Export analytics as CSV"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
       
        cursor.execute("""
            SELECT 
                u.session_id,
                u.visit_count,
                u.upload_count,
                u.download_count,
                u.first_seen,
                u.last_seen,
                u.reaction,
                u.email
            FROM users u
            ORDER BY u.last_seen DESC
        """)
       
        rows = cursor.fetchall()
        conn.close()
       
        csv_content = "Session ID,Visits,Uploads,Downloads,First Seen,Last Seen,Reaction,Email\n"
        for row in rows:
            csv_content += f"{row[0]},{row[1]},{row[2]},{row[3]},{row[4]},{row[5]},{row[6] or ''},{row[7] or ''}\n"
       
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=analytics_export.csv"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analytics/delete-database")
async def delete_database():
    """Delete all analytics data from database"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Count records before deletion
        cursor.execute("SELECT COUNT(*) FROM analytics")
        count_before = cursor.fetchone()[0]
        
        # Delete all records
        cursor.execute("DELETE FROM analytics")
        cursor.execute("DELETE FROM users")
        
        # Reset auto-increment counter
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='analytics'")
        
        conn.commit()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Successfully deleted {count_before} records",
            "records_deleted": count_before
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/events")
async def get_all_events():
    """Get all events - needed for admin panel to count reactions"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT session_id, event_type, timestamp
            FROM analytics
            ORDER BY timestamp DESC
        """)
        
        rows = cursor.fetchall()
        conn.close()
        
        events = [{"session_id": r[0], "event_type": r[1], "timestamp": r[2]} for r in rows]
        return {"events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/pmf-stats")
async def get_pmf_stats():
    """Get PMF statistics - power users and ALL reaction counts from events"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Count ALL reactions from analytics events table (not users table)
        # This counts every feedback event, even if same user gives feedback multiple times
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'reaction_love'")
        love_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'reaction_good'")
        good_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'reaction_okay'")
        okay_count = cursor.fetchone()[0]
        
        # Count ALL email submission events
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'email_pdf_requested'")
        emails_collected = cursor.fetchone()[0]
        
        # Count power users (users with 3+ downloads) - still from users table
        cursor.execute("SELECT COUNT(*) FROM users WHERE download_count >= 3")
        power_users = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            "power_users": power_users,
            "love_reactions": love_count,
            "good_reactions": good_count,
            "okay_reactions": okay_count,
            "emails_collected": emails_collected,
            "total_reactions": love_count + good_count + okay_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# Mount static files
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
    print(f"✅ Static files mounted from: {FRONTEND_DIR}")
else:
    print(f"⚠️ Warning: Frontend directory not found at {FRONTEND_DIR}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)