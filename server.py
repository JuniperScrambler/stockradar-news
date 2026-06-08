import http.server
import socketserver
import urllib.request
import urllib.parse
import json

PORT = 8080

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        # API endpoint: /api/news?q=...
        if parsed_url.path == '/api/news':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            q = query_params.get('q', [''])[0]
            
            if not q:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error": "Missing query parameter q"}')
                return
            
            # Construct Google News RSS query URL
            google_news_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=ja&gl=JP&ceid=JP:ja"
            
            try:
                # Set a standard User-Agent header to mimic browser requests and avoid blocks
                req = urllib.request.Request(
                    google_news_url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                )
                
                print(f"Proxying Google News query: {q}")
                with urllib.request.urlopen(req, timeout=10) as response:
                    xml_content = response.read().decode('utf-8')
                
                # Send JSON response wrapping the XML contents
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                # Format exactly as AllOrigins format: {"contents": "xml..."}
                response_data = {"contents": xml_content}
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
                
            except Exception as e:
                print(f"Proxy fetch error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
            
        # Default behavior: Serve static files
        return super().do_GET()

# Set server to allow port reuse immediately
class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

# Start server
print(f"Starting StockRadar local server on http://localhost:{PORT}...")
try:
    with ReusableTCPServer(("", PORT), MyHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
