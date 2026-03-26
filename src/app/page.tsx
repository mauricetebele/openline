'use client'
import { useState, useEffect } from 'react'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/context/AuthContext'
import { Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Wind, Droplets, Eye } from 'lucide-react'

// ─── Weather types & helpers ──────────────────────────────────────────────────

interface HourForecast {
  time: string
  temp: number
  weatherCode: number
}

interface Weather {
  temp: number
  feelsLike: number
  humidity: number
  windSpeed: number
  weatherCode: number
  city: string
  hourly: HourForecast[]
}

const WMO_LABELS: Record<number, { label: string; icon: typeof Sun }> = {
  0:  { label: 'Clear',          icon: Sun },
  1:  { label: 'Mostly Clear',   icon: Sun },
  2:  { label: 'Partly Cloudy',  icon: Cloud },
  3:  { label: 'Overcast',       icon: Cloud },
  45: { label: 'Foggy',          icon: Cloud },
  48: { label: 'Icy Fog',        icon: Cloud },
  51: { label: 'Light Drizzle',  icon: CloudDrizzle },
  53: { label: 'Drizzle',        icon: CloudDrizzle },
  55: { label: 'Heavy Drizzle',  icon: CloudDrizzle },
  61: { label: 'Light Rain',     icon: CloudRain },
  63: { label: 'Rain',           icon: CloudRain },
  65: { label: 'Heavy Rain',     icon: CloudRain },
  71: { label: 'Light Snow',     icon: CloudSnow },
  73: { label: 'Snow',           icon: CloudSnow },
  75: { label: 'Heavy Snow',     icon: CloudSnow },
  80: { label: 'Rain Showers',   icon: CloudRain },
  81: { label: 'Rain Showers',   icon: CloudRain },
  82: { label: 'Heavy Showers',  icon: CloudRain },
  85: { label: 'Snow Showers',   icon: CloudSnow },
  86: { label: 'Heavy Snow',     icon: CloudSnow },
  95: { label: 'Thunderstorm',   icon: CloudLightning },
  96: { label: 'Thunderstorm',   icon: CloudLightning },
  99: { label: 'Severe Storm',   icon: CloudLightning },
}

function getWeatherInfo(code: number) {
  return WMO_LABELS[code] ?? { label: 'Unknown', icon: Cloud }
}

// ─── Weather Widget ───────────────────────────────────────────────────────────

function WeatherWidget() {
  const [weather, setWeather] = useState<Weather | null>(null)

  useEffect(() => {
    // Eatontown, NJ
    const latitude = 40.2962
    const longitude = -74.0510

    ;(async () => {
      try {
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1`
        )
        const weatherData = await weatherRes.json()
        const c = weatherData.current

        // Parse hourly — next 12 hours from now
        const nowHour = new Date().getHours()
        const hourlyTimes: string[] = weatherData.hourly?.time ?? []
        const hourlyTemps: number[] = weatherData.hourly?.temperature_2m ?? []
        const hourlyCodes: number[] = weatherData.hourly?.weather_code ?? []
        const hourly: HourForecast[] = []
        for (let i = 0; i < hourlyTimes.length && hourly.length < 12; i++) {
          const h = new Date(hourlyTimes[i]).getHours()
          if (h > nowHour) {
            hourly.push({ time: hourlyTimes[i], temp: Math.round(hourlyTemps[i]), weatherCode: hourlyCodes[i] })
          }
        }

        setWeather({
          temp: Math.round(c.temperature_2m),
          feelsLike: Math.round(c.apparent_temperature),
          humidity: c.relative_humidity_2m,
          windSpeed: Math.round(c.wind_speed_10m),
          weatherCode: c.weather_code,
          city: 'Eatontown, NJ',
          hourly,
        })
      } catch { /* silently fail */ }
    })()
  }, [])

  if (!weather) return null

  const { label, icon: WeatherIcon } = getWeatherInfo(weather.weatherCode)

  function formatHour(iso: string) {
    const d = new Date(iso)
    const h = d.getHours()
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}${ampm}`
  }

  return (
    <div className="mt-8 rounded-xl bg-white/60 dark:bg-white/[0.06] border border-gray-200/60 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      {/* Current conditions */}
      <div className="flex items-center gap-4 px-5 py-3">
        <WeatherIcon size={28} className="text-gray-500 dark:text-gray-400 shrink-0" />
        <div className="text-left">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">{weather.temp}°F</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
          </div>
          {weather.city && (
            <p className="text-xs text-gray-400 dark:text-gray-500">{weather.city}</p>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-gray-200 dark:border-white/10 text-xs text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1"><Eye size={12} /> Feels {weather.feelsLike}°</span>
          <span className="flex items-center gap-1"><Droplets size={12} /> {weather.humidity}%</span>
          <span className="flex items-center gap-1"><Wind size={12} /> {weather.windSpeed} mph</span>
        </div>
      </div>

      {/* Hourly forecast */}
      {weather.hourly.length > 0 && (
        <div className="flex items-center gap-0 px-3 py-2 border-t border-gray-200/60 dark:border-white/10 overflow-x-auto scrollbar-hide">
          {weather.hourly.map((h) => {
            const { icon: HIcon } = getWeatherInfo(h.weatherCode)
            return (
              <div key={h.time} className="flex flex-col items-center gap-0.5 px-2.5 min-w-[48px]">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatHour(h.time)}</span>
                <HIcon size={14} className="text-gray-400 dark:text-gray-500" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{h.temp}°</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── OLM Watermark ────────────────────────────────────────────────────────────

function OlmLogoWatermark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200" fill="none"
      className="w-[280px] max-w-[60vw] h-auto opacity-[0.08] dark:opacity-[0.10] pointer-events-none select-none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wm-lg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#1B5EA6"/>
          <stop offset="100%" stopColor="#C1342C"/>
        </linearGradient>
      </defs>
      <path d="M60 105 C100 120, 160 40, 210 55" stroke="url(#wm-lg)" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
      <circle cx="58" cy="104" r="10" stroke="#1B5EA6" strokeWidth="3.5" fill="none"/>
      <circle cx="58" cy="104" r="3" fill="#1B5EA6"/>
      <circle cx="212" cy="54" r="11" stroke="#C1342C" strokeWidth="3.5" fill="none"/>
      <circle cx="212" cy="54" r="3.5" fill="#C1342C"/>
      <text x="140" y="148" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="32" fill="#1B3A5C" letterSpacing="3">OPEN LINE</text>
      <text x="140" y="175" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="22" fill="#C1342C" letterSpacing="6">MOBILITY</text>
    </svg>
  )
}

// ─── Home Content ─────────────────────────────────────────────────────────────

function HomeContent() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const firstName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? ''

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] overflow-hidden px-6 py-10 gap-6">
      {/* Greeting */}
      <div className={`text-center transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <p className="text-sm font-medium text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          {greeting}
        </p>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-white tracking-tight">
          Hello, <span className="text-amazon-orange">{firstName}</span>
        </h1>
      </div>

      {/* Watermark logo */}
      <div className={`transition-all duration-1000 delay-200 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
        <OlmLogoWatermark />
      </div>

      {/* Weather */}
      <div className={`transition-all duration-700 delay-400 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <WeatherWidget />
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <AppShell>
      <HomeContent />
    </AppShell>
  )
}
