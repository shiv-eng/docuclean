import os
import io
import sqlite3
import tempfile
import fitz  # PyMuPDF
from collections import Counter
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="PDF Watermark Remover")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup - Use temp directory for Railway
DB_FILE = os.path.join(tempfile.gettempdir(), "analytics.db")

def init_database():
    """Initialize SQLite database for analytics"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Create analytics table
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
        
        # Create index for faster queries
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
        print(f"✅ Database initialized successfully at {DB_FILE}")
    except Exception as e:
        print(f"⚠️ Database initialization error: {e}")

# Initialize database on startup
init_database()

# Pydantic models for analytics
class AnalyticsEvent(BaseModel):
    session_id: str
    event_type: str
    timestamp: str
    file_size: Optional[int] = None
    file_name: Optional[str] = None

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
    upload_events: int
    download_events: int

# Analytics functions
def track_analytics_event(event: AnalyticsEvent, request: Request):
    """Store analytics event in database"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        user_agent = request.headers.get("user-agent", "")
        ip_address = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        if "," in ip_address:
            ip_address = ip_address.split(",")[0].strip()
        
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
    except Exception as e:
        print(f"Analytics tracking error: {e}")

def get_analytics_stats() -> AnalyticsStats:
    """Get current analytics statistics for public view"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT COUNT(DISTINCT session_id)
            FROM analytics
            WHERE event_type = 'page_visit'
        """)
        unique_visitors = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*)
            FROM analytics
            WHERE event_type = 'file_upload'
        """)
        total_uploads = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*)
            FROM analytics
            WHERE event_type = 'file_download'
        """)
        total_downloads = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics")
        total_events = cursor.fetchone()[0]
        
        conn.close()
        
        return AnalyticsStats(
            unique_visitors=unique_visitors,
            total_uploads=total_uploads,
            total_downloads=total_downloads,
            total_events=total_events
        )
    except Exception as e:
        print(f"Stats error: {e}")
        return AnalyticsStats(unique_visitors=0, total_uploads=0, total_downloads=0, total_events=0)

def get_admin_stats() -> AdminStats:
    """Get detailed analytics statistics for admin"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT COUNT(DISTINCT session_id)
            FROM analytics
            WHERE event_type = 'page_visit'
        """)
        total_visitors = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(DISTINCT session_id)
            FROM analytics
            WHERE event_type = 'page_visit'
            GROUP BY session_id
            HAVING COUNT(*) > 1
        """)
        repeat_users = len(cursor.fetchall())
        
        unique_users = total_visitors - repeat_users
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'file_upload'")
        total_uploads = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'file_download'")
        total_downloads = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'page_visit'")
        page_visits = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'file_upload'")
        upload_events = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM analytics WHERE event_type = 'file_download'")
        download_events = cursor.fetchone()[0]
        
        conn.close()
        
        return AdminStats(
            unique_users=unique_users,
            repeat_users=repeat_users,
            total_uploads=total_uploads,
            total_downloads=total_downloads,
            page_visits=page_visits,
            upload_events=upload_events,
            download_events=download_events
        )
    except Exception as e:
        print(f"Admin stats error: {e}")
        return AdminStats(unique_users=0, repeat_users=0, total_uploads=0, total_downloads=0, 
                         page_visits=0, upload_events=0, download_events=0)

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
        return []

def clean_page_logic(page, header_h, footer_h, keywords, match_case=False):
    """Clean a single page by removing keywords and masking margins"""
    if keywords:
        for keyword in keywords:
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

def process_pdf_document(file_bytes, keywords, header_h, footer_h, match_case=False):
    """Process entire PDF document"""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    doc.set_metadata({})
    
    for page in doc:
        clean_page_logic(page, header_h, footer_h, keywords, match_case)
    
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    out.seek(0)
    return out.getvalue()

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
        return None

# Get the correct paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# API Routes - Health Check (IMPORTANT FOR RAILWAY)
@app.get("/health")
async def health_check():
    """Health check endpoint for Railway"""
    return {
        "status": "healthy",
        "service": "DocuClean PDF Watermark Remover",
        "version": "1.0.0"
    }

@app.get("/api/health")
async def api_health():
    """Alternative health check"""
    return {"status": "ok"}

# API Routes - Main
@app.get("/")
async def serve_index():
    """Serve the frontend HTML"""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    
    if not os.path.exists(index_path):
        return JSONResponse(
            content={
                "message": "Welcome to DocuClean API",
                "status": "running",
                "frontend": "not found",
                "health": "/health"
            }
        )
    return FileResponse(index_path)

@app.post("/analyze")
async def analyze_pdf(file: UploadFile = File(...)):
    """Analyze PDF and detect watermark candidates"""
    try:
        contents = await file.read()
        keywords = detect_watermark_candidates(contents)
        return {"keywords": ", ".join(keywords)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/preview")
async def preview_pdf(
    file: UploadFile = File(...),
    keywords: str = Form(""),
    header_h: int = Form(0),
    footer_h: int = Form(25),
    match_case: bool = Form(False)
):
    """Generate preview image of cleaned PDF"""
    try:
        contents = await file.read()
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
        
        preview_bytes = generate_preview_image(contents, kw_list, header_h, footer_h, match_case)
        
        if preview_bytes is None:
            raise HTTPException(status_code=400, detail="Could not generate preview")
        
        return Response(
            content=preview_bytes,
            media_type="image/png"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process")
async def process_pdf(
    file: UploadFile = File(...),
    keywords: str = Form(""),
    header_h: int = Form(0),
    footer_h: int = Form(25),
    match_case: bool = Form(False)
):
    """Process PDF and return cleaned version"""
    try:
        contents = await file.read()
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
        
        cleaned_pdf = process_pdf_document(contents, kw_list, header_h, footer_h, match_case)
        
        return Response(
            content=cleaned_pdf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=Clean_{file.filename}"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# API Routes - Analytics
@app.post("/analytics/track")
async def track_event(event: AnalyticsEvent, request: Request):
    """Track analytics event"""
    try:
        track_analytics_event(event, request)
        return {"status": "success"}
    except Exception as e:
        print(f"Analytics tracking error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/analytics/stats")
async def get_stats():
    """Get current analytics statistics"""
    try:
        stats = get_analytics_stats()
        return stats
    except Exception as e:
        print(f"Stats retrieval error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/admin-stats")
async def get_admin_statistics():
    """Get detailed admin statistics"""
    try:
        stats = get_admin_stats()
        return stats
    except Exception as e:
        print(f"Admin stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics/recent-activity")
async def get_recent_activity(limit: int = 20):
    """Get recent activity"""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            WITH session_counts AS (
                SELECT session_id, COUNT(*) as visit_count
                FROM analytics
                WHERE event_type = 'page_visit'
                GROUP BY session_id
            )
            SELECT 
                a.session_id, 
                a.event_type, 
                a.timestamp,
                CASE WHEN sc.visit_count > 1 THEN 1 ELSE 0 END as is_repeat
            FROM analytics a
            LEFT JOIN session_counts sc ON a.session_id = sc.session_id
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
            SELECT session_id, event_type, timestamp, file_size, ip_address
            FROM analytics
            ORDER BY timestamp DESC
        """)
        
        rows = cursor.fetchall()
        conn.close()
        
        csv_content = "Session ID,Event Type,Timestamp,File Size,IP Address\n"
        for row in rows:
            csv_content += f"{row[0]},{row[1]},{row[2]},{row[3] or ''},{row[4] or ''}\n"
        
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=analytics_export.csv"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
    print(f"✅ Static files mounted from: {FRONTEND_DIR}")
else:
    print(f"⚠️ Warning: Frontend directory not found at {FRONTEND_DIR}")

if __name__ == "__main__":
    import uvicorn
    
    # Get PORT from environment
    port = int(os.environ.get("PORT", 8000))
    
    print(f"🚀 Starting DocuClean on port {port}")
    print(f"📁 Database: {DB_FILE}")
    print(f"📂 Frontend: {FRONTEND_DIR}")
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=port,
        log_level="info"
    )