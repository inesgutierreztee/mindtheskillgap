export interface WeatherInfo {
  source: 'data_gov_sg' | 'mock_sg';
  area: string;
  forecast: string;
  isRaining: boolean;
  timestamp: string;
}

export async function fetchWeather(area?: string): Promise<WeatherInfo> {
  try {
    const res = await fetch(area ? `/api/weather?area=${encodeURIComponent(area)}` : '/api/weather');
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('fetchWeather error, using fallback', e);
  }
  return {
    source: 'mock_sg',
    area: area || 'Queenstown',
    forecast: 'Partly Cloudy (Fallback)',
    isRaining: false,
    timestamp: new Date().toISOString(),
  };
}
