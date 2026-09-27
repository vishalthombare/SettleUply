from enum import Enum


class ApplicationType(str, Enum):
    WEB = 'WEB'
    MOBILE = 'MOBILE'
    SYSTEM = 'SYSTEM'
    UNKNOWN = 'UNKNOWN'
