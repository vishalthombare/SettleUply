class AppError(Exception):
    def __init__(self, status: int, message: str, errors=None):
        self.status = status
        self.message = message
        self.errors = errors or {}
