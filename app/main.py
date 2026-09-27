import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from sqlalchemy.exc import IntegrityError
from app.core.config import get_settings
from app.exceptions import AppError
from app.api.v1 import auth, users, catalogs, transactions, groups, overview

app = FastAPI(title='SettleUply API', version='1.0.0', description='Private multi-currency ledgers, settlements and shared group expenses.')
app.add_middleware(CORSMiddleware, allow_origins=[get_settings().frontend_url.rstrip('/')], allow_credentials=True, allow_methods=['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type', 'X-Application-Type'])
for module in [auth, users, catalogs, transactions, groups, overview]:
    app.include_router(module.router, prefix='/api/v1')


def failure(status, message, errors=None):
    return JSONResponse(status_code=status, content={'success': False, 'message': message, 'errors': errors or {}})


@app.exception_handler(AppError)
async def application_error(request: Request, exc: AppError):
    return failure(exc.status, exc.message, exc.errors)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return failure(422, 'Please check the submitted fields', {'.'.join(str(p) for p in e['loc']): e['msg'] for e in exc.errors()})


@app.exception_handler(IntegrityError)
async def conflict(request: Request, exc: IntegrityError):
    return failure(409, 'This record conflicts with existing data')


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return failure(exc.status_code, str(exc.detail))


@app.exception_handler(Exception)
async def unexpected(request: Request, exc: Exception):
    logging.getLogger(__name__).exception('Unhandled request error')
    return failure(500, 'Something went wrong. Please try again.')


@app.get('/health')
async def health():
    return {'status': 'ok', 'database_configured': bool(get_settings().database_url)}
