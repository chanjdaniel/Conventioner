"""
reCAPTCHA v3 verification utility.
"""

import os
import requests
from typing import Tuple, Optional

RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
MIN_SCORE = 0.5  # Minimum score threshold for reCAPTCHA v3


def verify_recaptcha(token: str, ip_address: Optional[str] = None) -> Tuple[bool, float]:
    """Verify reCAPTCHA v3 token.

    Args:
        token: reCAPTCHA token from frontend
        ip_address: Optional IP address of the user

    Returns:
        Tuple of (success: bool, score: float)
        - success: True if verification passed and score >= MIN_SCORE
        - score: reCAPTCHA score (0.0 to 1.0)
    """
    # Explicit test-mode bypass: DISABLE_CAPTCHA skips verification entirely.
    # Only honored in non-production environments. Defaults OFF - production
    # stays protected by CAPTCHA regardless of this flag.
    if os.getenv("FLASK_ENV", "") != "production" and os.getenv("DISABLE_CAPTCHA", "").lower() in ("true", "1"):
        print("Warning: DISABLE_CAPTCHA is enabled - captcha verification skipped")
        return True, 1.0

    if not RECAPTCHA_SECRET_KEY:
        # In development, allow bypass if secret key not set
        print("Warning: RECAPTCHA_SECRET_KEY not set, skipping verification")
        return True, 1.0
    
    if not token:
        return False, 0.0
    
    try:
        data = {
            "secret": RECAPTCHA_SECRET_KEY,
            "response": token,
        }
        
        if ip_address:
            data["remoteip"] = ip_address
        
        response = requests.post(RECAPTCHA_VERIFY_URL, data=data, timeout=5)
        result = response.json()
        
        success = result.get("success", False)
        score = result.get("score", 0.0)
        
        # Check if score meets minimum threshold
        if success and score >= MIN_SCORE:
            return True, score
        else:
            print(f"reCAPTCHA verification failed: success={success}, score={score}")
            return False, score
            
    except Exception as e:
        print(f"Error verifying reCAPTCHA: {e}")
        return False, 0.0
