"""
Email service integration using Resend for sending verification emails, password reset emails, and OTP emails.

Every value this module needs is read from the environment when it is used, never captured into a
module global on the way up. The key used to be read at import and the client initialized there, and
that made this module's answer a function of *when it was imported* rather than of the environment:
the boot check could not be asked a question without knowing the import order, a ``.env`` loaded
afterwards was a ``.env`` nobody saw, and a test that cleared ``RESEND_API_KEY`` cleared nothing -
it had to know to patch a module attribute instead, which is a test passing for a reason unrelated
to what it claims. ``utils.secret_key`` and ``utils.captcha`` read on call for the same reason.
"""

import os
import logging
import resend

from utils.configured_secret import configured_secret, is_published
from utils.deployment import (
    INSECURE_LOCAL_DEV_VAR,
    insecure_local_dev,
    warn_insecure_local_dev,
)

# Set up logging
logger = logging.getLogger(__name__)

RESEND_API_KEY_VAR = "RESEND_API_KEY"

DEFAULT_FRONTEND_URL = "http://localhost:5173"
DEFAULT_FROM_EMAIL = "onboarding@resend.dev"  # Default Resend email


def configured_value() -> str:
    """What ``RESEND_API_KEY`` holds right now, whatever it holds."""
    return os.getenv(RESEND_API_KEY_VAR, "")


def sendable_key() -> str:
    """The key Resend can actually send with, or ``""`` when there is not one.

    A blank value is not a key, and neither is a placeholder this repository has published:
    ``re_xxxxx`` is *truthy*, so initializing the client on it would report a configured mailer to
    the boot check and then have Resend reject every send - one 500 per signup, with the new account
    rolled back behind it and nothing naming the variable. The check and the client ask this one
    question, so a deployment cannot pass the first and fail the second.
    """
    return configured_secret(configured_value())


def frontend_url() -> str:
    """The origin the verification and reset links this module sends point back at."""
    return os.getenv("FRONTEND_URL") or DEFAULT_FRONTEND_URL


def from_email() -> str:
    """The address this product's mail is sent from."""
    return os.getenv("FROM_EMAIL") or DEFAULT_FROM_EMAIL


def ready_mailer() -> bool:
    """Point the Resend client at this process's key, and say whether there was one to point it at.

    Called on the way into every send rather than once at import, so the key a send uses is the key
    the boot check passed on.
    """
    key = sendable_key()
    if not key:
        return False
    resend.api_key = key
    return True


class MailerNotConfiguredError(RuntimeError):
    """There is no mail key, so nothing this product sends would be delivered."""


def assert_mailer_configured() -> None:
    """Refuse to serve endpoints whose whole purpose is the mail they cannot send.

    Every route into an organizer account runs through this key. Registration rolls the new user
    back and answers 500 when the verification mail does not go out; an account that is never
    verified cannot log in; and the password-reset and OTP endpoints answer 500 as well. So a
    deployment that forgot this variable does not degrade - it cannot onboard a single organizer,
    and it says so one failed signup at a time, in a 500 that names nothing.

    That is the mirror image of the three defenses beside it, whose absence is never reported at
    all, and it wants the same answer: name the variable once, at boot, where an operator is
    looking, instead of leaving it to be inferred from the wreckage.

    Raises:
        MailerNotConfiguredError: when no key is configured and this is not an opted-in local
            development process, or when the configured value is a placeholder this repository has
            published - which holds everywhere, escape hatch or not, the same way it does for the
            signing key.
    """
    if is_published(configured_value()):
        raise MailerNotConfiguredError(
            f"{RESEND_API_KEY_VAR} is set to a placeholder this repository has printed, not to a "
            f"key. Resend rejects it, so every verification link, reset link and OTP this product "
            f"owes is a 500 with the account rolled back behind it - the same deployment that "
            f"cannot onboard anybody, arrived at by way of a check that passed. A truthy "
            f"placeholder is worse than a blank, because a check that asks only whether the "
            f"variable is set takes it for a configured secret. Set a real key "
            f"(https://resend.com/api-keys), or clear the variable and set "
            f"{INSECURE_LOCAL_DEV_VAR}=true (with DISABLE_EMAIL=true) if this is a local "
            f"development machine."
        )
    if sendable_key():
        return
    if insecure_local_dev():
        warn_insecure_local_dev(f"outbound email ({RESEND_API_KEY_VAR})")
        return
    raise MailerNotConfiguredError(
        f"{RESEND_API_KEY_VAR} is not set. It delivers the email-verification link, the "
        f"password-reset link, and the OTP login code - every route by which an organizer account "
        f"is reached. Without it, registration fails and rolls the account back, an unverified "
        f"organizer can never log in, and reset and OTP answer 500: not a degraded deployment, one "
        f"that cannot onboard anybody. Set {RESEND_API_KEY_VAR} (https://resend.com/api-keys), or "
        f"set {INSECURE_LOCAL_DEV_VAR}=true if this really is a local development machine."
    )

def _email_disabled() -> bool:
    """Return True when email sending is explicitly disabled for testing.

    Honored only by a process that has declared itself a local development one, and activated by the
    DISABLE_EMAIL env var. It used to be scoped by ``FLASK_ENV != "production"``, which scoped it to
    nothing: the Dockerfile exported ``FLASK_ENV=development`` and nothing overrode it, so a deployment
    that inherited ``DISABLE_EMAIL=true`` from a copied env file would silently send no mail at all
    -- while reporting every verification link and reset link as delivered. See ``utils.deployment``.
    """
    if not insecure_local_dev():
        return False
    return os.getenv("DISABLE_EMAIL", "").lower() in ("true", "1")


def send_verification_email(email: str, token: str) -> bool:
    """Send email verification link to user.
    
    Args:
        email: User's email address
        token: Verification token
        
    Returns:
        True if email sent successfully, False otherwise
    """
    verification_url = f"{frontend_url()}/verify-email?token={token}"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4CAF50;">Verify Your Email Address</h1>
        <p>Thank you for registering! Please verify your email address by clicking the link below:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{verification_url}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{verification_url}</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour.</p>
        <p style="color: #999; font-size: 12px;">If you didn't create an account, please ignore this email.</p>
    </body>
    </html>
    """
    
    text_content = f"""
    Verify Your Email Address
    
    Thank you for registering! Please verify your email address by visiting the following link:
    
    {verification_url}
    
    This link will expire in 1 hour.
    
    If you didn't create an account, please ignore this email.
    """
    
    if _email_disabled():
        logger.info("DISABLE_EMAIL is enabled - skipping verification email")
        return True

    if not ready_mailer():
        logger.error("Cannot send verification email: RESEND_API_KEY not set")
        return False

    try:
        response = resend.Emails.send({
            "from": from_email(),
            "to": [email],
            "subject": "Verify Your Email Address",
            "html": html_content,
            "text": text_content,
        })
        
        if response and hasattr(response, 'id'):
            logger.info(f"Verification email sent successfully to {email}, Resend ID: {response.id}")
            return True
        else:
            logger.error(f"Verification email send returned unexpected response: {response}")
            return False
            
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        logger.error(f"Error sending verification email to {email}: {error_type} - {error_msg}")
        
        # Log additional details if available
        if hasattr(e, 'response'):
            logger.error(f"API response: {e.response}")
        if hasattr(e, 'status_code'):
            logger.error(f"HTTP status code: {e.status_code}")
        if hasattr(e, 'message'):
            logger.error(f"Error message: {e.message}")
            
        # Log full exception traceback for debugging
        logger.debug(f"Full exception details:", exc_info=True)
        return False


def send_password_reset_email(email: str, token: str) -> bool:
    """Send password reset link to user.
    
    Args:
        email: User's email address
        token: Password reset token
        
    Returns:
        True if email sent successfully, False otherwise
    """
    reset_url = f"{frontend_url()}/reset-password?token={token}"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2196F3;">Reset Your Password</h1>
        <p>You requested to reset your password. Click the link below to create a new password:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{reset_url}" style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{reset_url}</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request a password reset, please ignore this email.</p>
    </body>
    </html>
    """
    
    text_content = f"""
    Reset Your Password
    
    You requested to reset your password. Visit the following link to create a new password:
    
    {reset_url}
    
    This link will expire in 1 hour.
    
    If you didn't request a password reset, please ignore this email.
    """
    
    if _email_disabled():
        logger.info("DISABLE_EMAIL is enabled - skipping password reset email")
        return True

    if not ready_mailer():
        logger.error("Cannot send password reset email: RESEND_API_KEY not set")
        return False

    try:
        response = resend.Emails.send({
            "from": from_email(),
            "to": [email],
            "subject": "Reset Your Password",
            "html": html_content,
            "text": text_content,
        })
        
        if response and hasattr(response, 'id'):
            logger.info(f"Password reset email sent successfully to {email}, Resend ID: {response.id}")
            return True
        else:
            logger.error(f"Password reset email send returned unexpected response: {response}")
            return False
            
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        logger.error(f"Error sending password reset email to {email}: {error_type} - {error_msg}")
        
        # Log additional details if available
        if hasattr(e, 'response'):
            logger.error(f"API response: {e.response}")
        if hasattr(e, 'status_code'):
            logger.error(f"HTTP status code: {e.status_code}")
        if hasattr(e, 'message'):
            logger.error(f"Error message: {e.message}")
            
        # Log full exception traceback for debugging
        logger.debug(f"Full exception details:", exc_info=True)
        return False


def send_otp_email(email: str, otp: str) -> bool:
    """Send OTP code for passwordless login.
    
    Args:
        email: User's email address
        otp: 6-digit OTP code
        
    Returns:
        True if email sent successfully, False otherwise
    """
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Login Code</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #9C27B0;">Your Login Code</h1>
        <p>You requested a passwordless login. Use the code below to sign in:</p>
        <div style="background-color: #f5f5f5; border: 2px dashed #9C27B0; padding: 20px; text-align: center; margin: 30px 0;">
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #9C27B0; margin: 0;">{otp}</p>
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This code will expire in 5 minutes.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
    </body>
    </html>
    """
    
    text_content = f"""
    Your Login Code
    
    You requested a passwordless login. Use the code below to sign in:
    
    {otp}
    
    This code will expire in 5 minutes.
    
    If you didn't request this code, please ignore this email.
    """
    
    if _email_disabled():
        logger.info("DISABLE_EMAIL is enabled - skipping OTP email")
        return True

    if not ready_mailer():
        logger.error("Cannot send OTP email: RESEND_API_KEY not set")
        return False

    try:
        response = resend.Emails.send({
            "from": from_email(),
            "to": [email],
            "subject": "Your Login Code",
            "html": html_content,
            "text": text_content,
        })
        
        if response and hasattr(response, 'id'):
            logger.info(f"OTP email sent successfully to {email}, Resend ID: {response.id}")
            return True
        else:
            logger.error(f"OTP email send returned unexpected response: {response}")
            return False
            
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        logger.error(f"Error sending OTP email to {email}: {error_type} - {error_msg}")
        
        # Log additional details if available
        if hasattr(e, 'response'):
            logger.error(f"API response: {e.response}")
        if hasattr(e, 'status_code'):
            logger.error(f"HTTP status code: {e.status_code}")
        if hasattr(e, 'message'):
            logger.error(f"Error message: {e.message}")
            
        # Log full exception traceback for debugging
        logger.debug(f"Full exception details:", exc_info=True)
        return False
