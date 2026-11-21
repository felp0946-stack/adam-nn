import csv
import io
import mimetypes
from xml.sax.saxutils import escape

from PIL import Image

MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "py": "text/x-python", "js": "text/javascript", "ts": "text/plain", "jsx": "text/plain",
    "html": "text/html", "css": "text/css", "json": "application/json", "md": "text/markdown",
    "csv": "text/csv", "txt": "text/plain", "svg": "image/svg+xml", "sql": "text/plain",
}


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else "txt"


def _lines(content: str):
    for raw in content.replace("\r", "").split("\n"):
        line = raw.rstrip()
        if line.startswith("### "):
            yield "h3", line[4:]
        elif line.startswith("## "):
            yield "h2", line[3:]
        elif line.startswith("# "):
            yield "h1", line[2:]
        elif line.lstrip().startswith(("- ", "* ", "• ")):
            yield "li", line.lstrip()[2:]
        elif not line.strip():
            yield "sp", ""
        else:
            yield "p", line


def _md_inline(text: str) -> str:
    parts = escape(text).split("**")
    return "".join(f"<b>{p}</b>" if i % 2 else p for i, p in enumerate(parts))


def build_pdf(content: str, title: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=title, author="Adam AI", leftMargin=56, rightMargin=56)
    st = getSampleStyleSheet()
    styles = {"h1": st["Heading1"], "h2": st["Heading2"], "h3": st["Heading3"], "p": st["BodyText"], "li": st["BodyText"]}
    story = []
    for kind, text in _lines(content):
        if kind == "sp":
            story.append(Spacer(1, 6))
        else:
            story.append(Paragraph(("• " if kind == "li" else "") + _md_inline(text), styles[kind]))
    doc.build(story or [Paragraph(" ", st["BodyText"])])
    return buf.getvalue()


def build_docx(content: str) -> bytes:
    from docx import Document
    d = Document()
    for kind, text in _lines(content):
        clean = text.replace("**", "")
        if kind in ("h1", "h2", "h3"):
            d.add_heading(clean, level=int(kind[1]))
        elif kind == "li":
            d.add_paragraph(clean, style="List Bullet")
        elif kind == "p":
            d.add_paragraph(clean)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def build_xlsx(content: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    text = content.strip()
    delim = ";" if text.split("\n")[0].count(";") > text.split("\n")[0].count(",") else ","
    wb = Workbook()
    ws = wb.active
    ws.title = "Adam"
    for r, row in enumerate(csv.reader(io.StringIO(text), delimiter=delim), start=1):
        for c, val in enumerate(row, start=1):
            v = val.strip()
            try:
                v = float(v.replace(",", ".")) if v and v.replace(",", ".").replace(".", "", 1).lstrip("-").isdigit() else v
            except ValueError:
                pass
            cell = ws.cell(row=r, column=c, value=v)
            if r == 1:
                cell.font = Font(bold=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_file(filename: str, content: str):
    ext = ext_of(filename)
    if ext == "pdf":
        return build_pdf(content, filename), MIME["pdf"]
    if ext == "docx":
        return build_docx(content), MIME["docx"]
    if ext == "xlsx":
        return build_xlsx(content), MIME["xlsx"]
    mime = MIME.get(ext) or mimetypes.guess_type(filename)[0] or "text/plain"
    return content.encode("utf-8"), mime


def extract_text(data: bytes, filename: str, mime: str) -> str:
    ext = ext_of(filename)
    try:
        if ext == "pdf":
            from pypdf import PdfReader
            return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages[:50])
        if ext == "docx":
            from docx import Document
            return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
        if ext == "xlsx":
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            rows = []
            for ws in wb.worksheets[:3]:
                rows.append(f"[Planilha {ws.title}]")
                for row in ws.iter_rows(max_row=300, values_only=True):
                    rows.append(";".join("" if v is None else str(v) for v in row))
            return "\n".join(rows)
        if mime.startswith("text/") or ext in MIME or mime in ("application/json",):
            return data.decode("utf-8", errors="ignore")
    except Exception as e:
        return f"[Não foi possível ler o arquivo: {e}]"
    return ""


def image_to_jpeg_b64(data: bytes) -> str:
    import base64
    img = Image.open(io.BytesIO(data))
    img.seek(0)
    img = img.convert("RGB")
    img.thumbnail((1568, 1568))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()
