from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class WalkerData(BaseModel):
    device_id: str
    steps: int
    tilt_angle: float
    wobble_score: float
    ts_ms: int

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/data")
def ingest(payload: WalkerData):
    print(payload.model_dump())
    return {"ok": True}
