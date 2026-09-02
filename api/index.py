from api.settlement import calculate_settlements, Expense
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_talisman import Talisman
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import sys
import os
import logging
from datetime import datetime

# Import auth helpers
from api.auth import init_auth, require_auth

# 1. Tell Vercel where to look FIRST
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


app = Flask(__name__)

# Limit request size to 1MB to avoid large payload abuse
app.config['MAX_CONTENT_LENGTH'] = int(
    os.getenv('MAX_CONTENT_LENGTH', 1 * 1024 * 1024))

# Production-ready CORS configuration
CORS(app,
     origins=os.getenv('CORS_ORIGINS', 'http://localhost:3000').split(','),
     methods=['GET', 'POST', 'OPTIONS'],
     allow_headers=['Content-Type'],
     supports_credentials=False,
     max_age=3600)

# Content Security Policy: keep reasonably strict but allow Firebase and Google SDKs
# Review and tighten by replacing domains with your production host where possible
csp = {
    'default-src': "'self'",
    'script-src': "'self' https://www.gstatic.com https://apis.google.com https://cdn.jsdelivr.net",
    'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
    'img-src': "'self' data: https:",
    'connect-src': "'self' https://*.firebaseio.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    'font-src': "'self' data: https://fonts.gstatic.com",
    'frame-src': "https://*.firebaseapp.com https://apis.google.com"
}

# Enforce secure headers and CSP via Talisman
Talisman(app, content_security_policy=csp, force_https=True)

# Rate limiting decorator
request_counts = {}


def rate_limit(max_requests=30, window_seconds=60):
    """Rate limiting decorator for API endpoints"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr or 'unknown'
            now = datetime.now().timestamp()

            if client_ip not in request_counts:
                request_counts[client_ip] = []

            # Clean old requests outside the window
            request_counts[client_ip] = [
                req_time for req_time in request_counts[client_ip]
                if now - req_time < window_seconds
            ]

            if len(request_counts[client_ip]) >= max_requests:
                logger.warning(f"Rate limit exceeded for IP: {client_ip}")
                return jsonify({
                    "error": "Too many requests. Please try again later.",
                    "status": 429
                }), 429

            request_counts[client_ip].append(now)
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# Initialize Flask-Limiter (Redis if REDIS_URL provided, otherwise in-memory)
redis_url = os.getenv('REDIS_URL')
try:
    if redis_url:
        limiter = Limiter(app, key_func=get_remote_address,
                          storage_uri=redis_url)
        logger.info('Flask-Limiter configured with Redis')
    else:
        limiter = Limiter(app, key_func=get_remote_address,
                          storage_uri='memory://')
        logger.info('Flask-Limiter configured with in-memory store')
except Exception as e:
    limiter = None
    logger.warning(f'Flask-Limiter initialization failed: {e}')


# Initialize auth helpers (Firebase Admin if configured)
init_auth(logger)


@app.before_request
def log_request():
    """Log all incoming requests"""
    logger.info(f"{request.method} {request.path} from {request.remote_addr}")


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


# `require_auth` is provided by `api.auth` and initialized above.


@app.route('/api', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "message": "GroupTab Backend API v1.0",
        "timestamp": datetime.now().isoformat()
    })


@app.route('/api/calculate', methods=['POST'])
@require_auth
def calculate():
    """Calculate settlement amounts between users"""
    try:
        # Validate request
        if not request.json:
            return jsonify({"error": "Request body must be JSON"}), 400

        data = request.json

        if not isinstance(data, list):
            return jsonify({"error": "Expected array of expenses"}), 400

        if len(data) == 0:
            return jsonify({"error": "No expenses to calculate"}), 400

        # Build expenses list with validation
        expenses_list = []
        for i, item in enumerate(data):
            try:
                # Validate required fields
                if not all(k in item for k in ['payer', 'amount', 'involved']):
                    return jsonify({
                        "error": f"Expense {i}: missing required fields (payer, amount, involved)"
                    }), 400

                if not isinstance(item['involved'], list) or len(item['involved']) == 0:
                    return jsonify({
                        "error": f"Expense {i}: 'involved' must be a non-empty array of people"
                    }), 400

                # Validate amount is positive number
                amount = float(item['amount'])
                if amount <= 0:
                    return jsonify({
                        "error": f"Expense {i}: amount must be positive"
                    }), 400

                expenses_list.append(Expense(
                    item['payer'],
                    amount,
                    item['involved']
                ))
            except (ValueError, TypeError) as e:
                return jsonify({
                    "error": f"Expense {i}: invalid data format - {str(e)}"
                }), 400

        # Apply rate limit if limiter is configured (fallback to in-memory decorator exists)
        try:
            rate_requests = int(os.getenv('RATE_LIMIT_REQUESTS', 30))
            rate_window = int(os.getenv('RATE_LIMIT_WINDOW', 60))
            if limiter:
                # Flask-Limiter uses rate strings like '30 per minute' or '5 per 10 seconds'
                rate_str = f"{rate_requests} per {rate_window} seconds"
                # Dynamically check the limit by calling limiter._check_request_limit
                # Simpler: use the limiter.limit decorator by invoking a wrapped function

                @limiter.limit(rate_str)
                def _calculate_inner():
                    return calculate_settlements(expenses_list)

                results = _calculate_inner()
            else:
                results = calculate_settlements(expenses_list)
        except Exception as e:
            logger.warning(
                f"Rate limiter check failed or calculation error: {e}")
            results = calculate_settlements(expenses_list)
        logger.info(
            f"Successfully calculated settlements for {len(expenses_list)} expenses")

        return jsonify({
            "success": True,
            "data": results,
            "timestamp": datetime.now().isoformat()
        })

    except Exception as e:
        logger.error(f"Error calculating settlements: {str(e)}", exc_info=True)
        return jsonify({
            "error": "Internal server error during calculation",
            "details": str(e) if os.getenv('FLASK_ENV') != 'production' else None
        }), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    logger.warning(f"404 Not Found: {request.path}")
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    logger.error(f"500 Internal Server Error: {str(error)}", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500


# This is for local testing only
if __name__ == '__main__':
    app.run(debug=os.getenv('FLASK_ENV') == 'development', port=5000)
