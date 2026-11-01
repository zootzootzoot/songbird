import base64, sys, time, json
sys.path.insert(0, '.')
from songbird import config
import httpx
img = sys.argv[1]; phrase = sys.argv[2]
b64 = base64.b64encode(open(img,'rb').read()).decode()
body = {"model": config.SAM, "input": [{"type":"message","role":"user","content":[
  {"type":"input_text","text": phrase},
  {"type":"input_image","image_url": "data:image/jpeg;base64,"+b64}]}],
  "metadata": {"include_confidence": "true"}}
t=time.time()
r = httpx.post(config.META_BASE+"/responses", json=body, headers={"Authorization":"Bearer "+config.META_KEY}, timeout=120)
print(r.status_code, round(time.time()-t,2), "s")
j = r.json()
print(json.dumps(j)[:1500])
