from app.models.entities import (
    User, UserSettings, UserSession, OTPVerification, Contact, Category, PaymentMethod,
    Transaction, TransactionSettlement, Group, GroupMember, GroupExpense, ExpenseSplit,
    Reminder, NotificationLog,
)

# Register audit hooks for application sessions, CLI commands, and test sessions.
from app.db import audit as _audit
