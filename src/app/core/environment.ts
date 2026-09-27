export const environment = {
  API_BASE_URL: 'http://localhost:8000/api/v1',
  // AUTO records phone/tablet browsers as MOBILE and desktop browsers as WEB.
  // A dedicated client can explicitly select WEB or MOBILE.
  APPLICATION_TYPE: 'AUTO' as 'AUTO' | 'WEB' | 'MOBILE',
};
