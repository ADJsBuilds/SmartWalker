import os
import time
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from app.core.config import get_settings


async def save_resident_document(resident_id: str, file: UploadFile) -> str:
    settings = get_settings()
    base_dir = Path(settings.storage_dir) / 'residents' / resident_id / 'docs'
    base_dir.mkdir(parents=True, exist_ok=True)

    safe_name = os.path.basename(file.filename or 'upload.pdf')
    path = base_dir / f'{int(time.time())}_{safe_name}'

    async with aiofiles.open(path, 'wb') as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            await out.write(chunk)
    await file.close()

    return str(path)


def resident_report_path(resident_id: str, date_str: str) -> str:
    settings = get_settings()
    out_dir = Path(settings.storage_dir) / 'residents' / resident_id / 'reports'
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / f'{date_str}.pdf')
