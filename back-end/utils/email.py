"""
Email service integration using Resend for sending verification emails, password reset emails, and OTP emails.
"""

import os
from typing import Optional
from resend import Resend

# Initialize Resend client
resend_api_key = os.getenv("RESEND_API_KEY")
resend = None
if resend_api_key:
    resend = Resend(api_key=resend_api_key)

# Get frontend URL from environment
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
FROM_EMAIL = os.getenv("FROM_EMAIL", "onboarding@resend.dev")  # Default Resend email


def send_verification_email(email: str, token: str) -> bool:
    """Send email verification link to user.
    
    Args:
        email: User's email address
        token: Verification token
        
    Returns:
        True if email sent successfully, False otherwise
    """
    verification_url = f"{FRONTEND_URL}/verify-email?token={token}"
    
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
    
    if not resend:
        print("Warning: RESEND_API_KEY not set, skipping email send")
        return False
    
    try:
        resend.emails.send({
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "Verify Your Email Address",
            "html": html_content,
            "text": text_content,
        })
        return True
    except Exception as e:
        print(f"Error sending verification email: {e}")
        return False


def send_password_reset_email(email: str, token: str) -> bool:
    """Send password reset link to user.
    
    Args:
        email: User's email address
        token: Password reset token
        
    Returns:
        True if email sent successfully, False otherwise
    """
    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
    
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
    
    if not resend:
        print("Warning: RESEND_API_KEY not set, skipping email send")
        return False
    
    try:
        resend.emails.send({
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "Reset Your Password",
            "html": html_content,
            "text": text_content,
        })
        return True
    except Exception as e:
        print(f"Error sending password reset email: {e}")
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
    
    if not resend:
        print("Warning: RESEND_API_KEY not set, skipping email send")
        return False
    
    try:
        resend.emails.send({
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "Your Login Code",
            "html": html_content,
            "text": text_content,
        })
        return True
    except Exception as e:
        print(f"Error sending OTP email: {e}")
        return False
