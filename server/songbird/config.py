"""Settings, read from ../.env (repo root) and the environment."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
DATA = SERVER / "data"
TAPES = DATA / "tapes"


def _load_env():
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

META_KEY = os.environ.get("MODEL_API_KEY") or os.environ.get("API_MODEL_KEY") or os.environ.get("META_API_KEY") or ""
META_BASE = os.environ.get("META_BASE_URL", "https://api.meta.ai/v1")
SPARK = os.environ.get("SPARK_MODEL", "muse-spark-1.3")
IMAGE = os.environ.get("IMAGE_MODEL", "muse-image-1.0")
SAM = os.environ.get("SAM_MODEL", "sam-3.1")
SOULX_DIR = Path(os.environ.get("SOULX_DIR", ROOT.parent / "rea-work/songlab/engines/soulx-singer"))
SOULX_PY = Path(os.environ.get("SOULX_PY", SOULX_DIR / ".venv/Scripts/python.exe"))
PORT = int(os.environ.get("PORT", "8787"))
