import os
import json
import logging
import time
from functools import wraps
from flask import request, jsonify

# Optional firebase-admin import (may be absent in dev/test)
try:
    import firebase_admin
    from firebase_admin import credentials as firebase_credentials
    from firebase_admin import auth as firebase_admin_auth
    _FIREBASE_INSTALLED = True
except Exception:
    firebase_admin = None
    firebase_credentials = None
    firebase_admin_auth = None
    _FIREBASE_INSTALLED = False

import requests
import jwt
from jwt import InvalidTokenError

logger = logging.getLogger(__name__)

# Holds runtime state after init
_FIREBASE_AVAILABLE = False
_firebase_auth = None

# Public keys cache for pyjwt-based verification
_PUBKEYS = None
_PUBKEYS_FETchtime = 0
_PUBKEYS_TTL = 60 * 60  # 1 hour


def _fetch_firebase_pubkeys():
    global _PUBKEYS, _PUBKEYS_FETchtime
    # Firebase publishes keys here for ID tokens
    url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        _PUBKEYS = resp.json()
        _PUBKEYS_FETchtime = int(time.time())
        return _PUBKEYS
    except Exception as e:
        logger.exception('Failed to fetch Firebase public keys: %s', e)
        return None


def _get_pubkeys():
    global _PUBKEYS, _PUBKEYS_FETchtime
    if not _PUBKEYS or (int(time.time()) - _PUBKEYS_FETchtime) > _PUBKEYS_TTL:
        _fetch_firebase_pubkeys()
    return _PUBKEYS


def init_auth(app_logger=None):
    """Initialize authentication verification.

    Attempts to initialize Firebase Admin SDK if available and a service account
    is provided. If not available, configures a pyjwt-based verification path
    which requires `FIREBASE_PROJECT_ID` to be set.
    Returns True if any verification path is available.
    """
    global _FIREBASE_AVAILABLE, _firebase_auth
    if app_logger:
        global logger
        logger = app_logger

    # Try firebase-admin if installed and service account provided
    service_account_json = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
    service_account_file = os.getenv('FIREBASE_SERVICE_ACCOUNT_FILE')
    if _FIREBASE_INSTALLED and (service_account_json or service_account_file):
        try:
            sa = None
            if service_account_json:
                sa = json.loads(service_account_json)
            elif service_account_file:
                with open(service_account_file, 'r') as f:
                    sa = json.load(f)
            if sa:
                cred = firebase_credentials.Certificate(sa)
                firebase_admin.initialize_app(cred)
                _firebase_auth = firebase_admin_auth
                _FIREBASE_AVAILABLE = True
                logger.info(
                    'Firebase Admin initialized for token verification')
                return True
        except Exception:
            logger.exception('Failed to initialize Firebase Admin')

    # Fallback: require FIREBASE_PROJECT_ID for pyjwt verification
    project_id = os.getenv('FIREBASE_PROJECT_ID')
    if project_id:
        # Warm fetch keys to verify endpoint availability
        if _fetch_firebase_pubkeys():
            _FIREBASE_AVAILABLE = True
            logger.info('pyjwt-based Firebase token verification enabled')
            return True
        else:
            logger.warning(
                'Could not fetch Firebase public keys; verification disabled')
    else:
        logger.warning(
            'FIREBASE_PROJECT_ID not set; pyjwt verification disabled')

    _FIREBASE_AVAILABLE = False
    return False


def _verify_token_with_pyjwt(id_token: str):
    """Verify a Firebase ID token using Google's public keys and pyjwt.

    Returns decoded token dict on success or raises an exception on failure.
    """
    project_id = os.getenv('FIREBASE_PROJECT_ID')
    if not project_id:
        raise RuntimeError('FIREBASE_PROJECT_ID not configured')

    unverified_header = jwt.get_unverified_header(id_token)
    kid = unverified_header.get('kid')
    if not kid:
        raise InvalidTokenError('Token missing kid header')

    keys = _get_pubkeys()
    if not keys or kid not in keys:
        # Try refetch once
        _fetch_firebase_pubkeys()
        keys = _get_pubkeys()
        if not keys or kid not in keys:
            raise InvalidTokenError('Unable to find public key for token')

    public_key_pem = keys[kid]
    issuer = f'https://securetoken.google.com/{project_id}'
    try:
        decoded = jwt.decode(
            id_token,
            public_key_pem,
            algorithms=['RS256'],
            audience=project_id,
            issuer=issuer,
        )
        return decoded
    except Exception as e:
        logger.warning('pyjwt verification failed: %s', e)
        raise


def require_auth(f):
    """Decorator to require authentication for endpoints.

    Behavior:
    - If FLASK_ENV=development, skips auth for convenience.
    - If Firebase verification is available, verifies `Authorization: Bearer <id_token>`.
    - Otherwise falls back to checking `X-API-KEY` environment variable.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        # Allow local development without tokens
        if os.getenv('FLASK_ENV') == 'development':
            return f(*args, **kwargs)

        # Prefer Firebase ID token verification via firebase-admin if available
        if _FIREBASE_AVAILABLE and _firebase_auth:
            auth_header = request.headers.get('Authorization', None)
            if not auth_header or not auth_header.startswith('Bearer '):
                return jsonify({'error': 'Authorization header missing'}), 401
            id_token = auth_header.split(' ', 1)[1]
            try:
                decoded = _firebase_auth.verify_id_token(id_token)
                request.user = decoded
                return f(*args, **kwargs)
            except Exception as e:
                logger.warning('Invalid Firebase token (admin): %s', e)
                return jsonify({'error': 'Invalid or expired token'}), 401

        # Next fallback: pyjwt verification
        if _FIREBASE_AVAILABLE:
            auth_header = request.headers.get('Authorization', None)
            if not auth_header or not auth_header.startswith('Bearer '):
                return jsonify({'error': 'Authorization header missing'}), 401
            id_token = auth_header.split(' ', 1)[1]
            try:
                decoded = _verify_token_with_pyjwt(id_token)
                request.user = decoded
                return f(*args, **kwargs)
            except Exception as e:
                logger.warning('Invalid Firebase token (pyjwt): %s', e)
                return jsonify({'error': 'Invalid or expired token'}), 401

        # Fallback to static API key if configured
        api_key = os.getenv('X_API_KEY')
        if api_key:
            provided = request.headers.get(
                'X-API-KEY') or request.args.get('api_key')
            if provided and provided == api_key:
                return f(*args, **kwargs)
            logger.warning('Invalid or missing API key')
            return jsonify({'error': 'Invalid or missing API key'}), 401

        logger.error('No authentication mechanism configured')
        return jsonify({'error': 'Authentication not configured on server'}), 500

    return decorated
