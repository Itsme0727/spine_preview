"""
腾讯 TMT 翻译代理 — Python 版（无需额外安装依赖）
启动: python server.py
默认端口 3001
"""
import json
import hashlib
import hmac
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError

PORT = 3001

def sign_tmt(secret_id, secret_key, payload, region="ap-guangzhou"):
    """腾讯云 API v3 签名"""
    service = "tmt"
    host = "tmt.tencentcloudapi.com"
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(time.time())
    date = time.strftime("%Y-%m-%d", time.gmtime(timestamp))

    # Step 1: Canonical Request
    http_method = "POST"
    canonical_uri = "/"
    canonical_querystring = ""
    ct = "application/json; charset=utf-8"
    canonical_headers = f"content-type:{ct}\nhost:{host}\n"
    signed_headers = "content-type;host"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = f"{http_method}\n{canonical_uri}\n{canonical_querystring}\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"

    # Step 2: String to Sign
    credential_scope = f"{date}/{service}/tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_canonical}"

    # Step 3: Signature
    def _sign(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    secret_date = _sign(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _sign(secret_date, service)
    secret_signing = _sign(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    # Step 4: Authorization header
    authorization = f"{algorithm} Credential={secret_id}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    return {"Authorization": authorization, "Content-Type": ct, "Host": host, "X-TC-Action": "TextTranslate", "X-TC-Version": "2018-03-21", "X-TC-Timestamp": str(timestamp), "X-TC-Region": region}


class ProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/tmt":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length))
        texts = body.get("texts", [])
        secret_id = body.get("secretId", "")
        secret_key = body.get("secretKey", "")
        region = body.get("region", "ap-guangzhou")
        source = body.get("source", "auto")
        target = body.get("target", "zh")

        if not texts:
            self._json(200, {"translations": []})
            return
        if not secret_id or not secret_key:
            self._json(400, {"error": "请配置 secretId 和 secretKey"})
            return

        payload = json.dumps({"SourceText": "\n".join(texts), "Source": source, "Target": target, "ProjectId": 0})
        headers = sign_tmt(secret_id, secret_key, payload, region)

        try:
            req = Request("https://tmt.tencentcloudapi.com", data=payload.encode("utf-8"), headers=headers)
            resp = urlopen(req, timeout=10)
            result = json.loads(resp.read().decode("utf-8"))
            translations = result.get("Response", {}).get("TargetText", "").split("\n")
            print(f"[TMT] {len(texts)} texts → {len(translations)} translations")
            self._json(200, {"translations": translations})
        except URLError as e:
            print(f"[TMT] Error: {e}")
            self._json(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, data):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # 静默 HTTP 日志


if __name__ == "__main__":
    print(f"🔄 TMT 翻译代理已启动: http://localhost:{PORT}/tmt")
    print("   在 js/spine-loading.js 的 TMT_CONFIG 中配置 secretId/secretKey")
    HTTPServer(("127.0.0.1", PORT), ProxyHandler).serve_forever()
