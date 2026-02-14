def extract_pdf_text(filepath: str) -> str:
    try:
        import pdfplumber
    except Exception:
        return ''

    text_parts = []
    try:
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                text_parts.append(page.extract_text() or '')
    except Exception:
        return ''

    return "\n".join(part for part in text_parts if part).strip()
