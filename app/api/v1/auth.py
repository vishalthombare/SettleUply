from fastapi import APIRouter, Request, Response, Depends
from app.api.dependencies import DB, CurrentUser, trusted_origin
from app.schemas.inputs import Register, Login, LoginChallenge, VerifyLoginOTP, VerifyOTP, EmailInput, ResetPassword, ChangePassword
from app.services.auth import AuthService
from app.models.enums import OTPPurpose
from app.core.config import get_settings
from app.utils.serialization import ok

router = APIRouter(prefix='/auth', tags=['auth'])


def cookie(response, raw):
    config = get_settings()
    response.set_cookie('settleuply_refresh', raw, httponly=True, secure=config.app_env != 'development', samesite='strict', path='/api/v1/auth', max_age=config.refresh_token_expire_days * 86400)


@router.post('/register', status_code=201)
async def register(data: Register, db: DB):
    await AuthService(db).register(data)
    return ok(message='If registration is available, a verification code will be sent')


@router.post('/verify-otp')
async def verify(data: VerifyOTP, db: DB):
    await AuthService(db).verify_registration(data)
    return ok(message='Email verified. Your account is awaiting administrator approval.')


@router.post('/resend-otp')
async def resend(data: EmailInput, db: DB):
    await AuthService(db).resend(data.email, OTPPurpose.REGISTRATION)
    return ok(message='If eligible, a new code will be sent')


@router.post('/login')
async def login(data: Login, db: DB):
    result = await AuthService(db).login(data)
    return ok(result, message='Enter the sign-in code sent to your email')


@router.post('/verify-login-otp')
async def verify_login(data: VerifyLoginOTP, request: Request, response: Response, db: DB):
    result, raw = await AuthService(db).verify_login(data, request)
    cookie(response, raw)
    return ok(result)


@router.post('/resend-login-otp')
async def resend_login(data: LoginChallenge, db: DB):
    result = await AuthService(db).resend_login(data.challenge_token)
    return ok(result, message='A new sign-in code has been sent')


@router.post('/refresh', dependencies=[Depends(trusted_origin)])
async def refresh(request: Request, response: Response, db: DB):
    result, raw = await AuthService(db).refresh(request.cookies.get('settleuply_refresh'), request)
    cookie(response, raw)
    return ok(result)


@router.post('/logout', dependencies=[Depends(trusted_origin)])
async def logout(request: Request, response: Response, db: DB):
    await AuthService(db).logout(request.cookies.get('settleuply_refresh'))
    response.delete_cookie('settleuply_refresh', path='/api/v1/auth')
    return ok(message='Signed out')


@router.post('/forgot-password')
async def forgot(data: EmailInput, db: DB):
    await AuthService(db).resend(data.email, OTPPurpose.PASSWORD_RESET)
    return ok(message='If the account exists, a reset code will be sent')


@router.post('/reset-password')
async def reset(data: ResetPassword, db: DB):
    await AuthService(db).reset_password(data)
    return ok(message='Password reset. Please sign in.')


@router.post('/change-password')
async def change(data: ChangePassword, db: DB, user: CurrentUser):
    await AuthService(db).change_password(user, data)
    return ok(message='Password changed. Please sign in again.')
