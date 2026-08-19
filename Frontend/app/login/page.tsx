"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuthStore } from "@/store/auth-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import Image from "next/image"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { BrandWordmark } from "@/components/shared/brand-wordmark"

// Background images for the slideshow - using local images
const BACKGROUND_IMAGES = [
  "/login-backgrounds/majiscopebackgrd-1.jpg",
  "/login-backgrounds/majiscopebackgrd-2.jpg",
  "/login-backgrounds/majiscopebackgrd-3.jpg",
  "/login-backgrounds/majiscopebackgrd-4.jpg",
  "/login-backgrounds/majiscopebackgrd-5.jpg",
]

// Rotating slogans - swap in sync with the background slideshow.
// Each slogan is split into two parts: the first uses the brand gradient
// (matching "Maji"), the second uses white (matching "Scope").
const SLOGANS: { first: string; second: string }[] = [
  { first: "Powering Water Management", second: "with Technology" },
  { first: "Enhancing Every Drop", second: "with Technology" },
  { first: "Smart Water.", second: "Informed Management." },
  { first: "Every Drop,", second: "Fully Accounted." },
  { first: "Where Data", second: "Meets Water." },
  { first: "Water Intelligence,", second: "Reimagined." },
]

export default function LoginPage() {
  const router = useRouter()
  const { login, isLoading, error, clearError } = useAuthStore()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [pauseSlideshow, setPauseSlideshow] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  const goToSlide = (index: number) => {
    if (prefersReducedMotion) {
      setCurrentImageIndex(index)
      setIsTransitioning(false)
      return
    }

    setIsTransitioning(true)
    setTimeout(() => {
      setCurrentImageIndex(index)
      setIsTransitioning(false)
    }, 500)
  }

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)
    updatePreference()

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updatePreference)
      return () => mediaQuery.removeEventListener("change", updatePreference)
    }

    mediaQuery.addListener(updatePreference)
    return () => mediaQuery.removeListener(updatePreference)
  }, [])

  // Dynamic background slideshow
  useEffect(() => {
    if (pauseSlideshow || prefersReducedMotion) {
      return
    }

    const interval = setInterval(() => {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentImageIndex((prev) => (prev + 1) % BACKGROUND_IMAGES.length)
        setIsTransitioning(false)
      }, 1000)
    }, 6000)

    return () => clearInterval(interval)
  }, [pauseSlideshow, prefersReducedMotion])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError?.()

    if (!email || !password) {
      toast.error("Please enter email and password")
      return
    }

    try {
      const success = await login(email, password)
      if (success) {
        toast.success("Karibu MajiScope!")
        router.push("/dashboard")
      }
    } catch (err) {
      // Error is handled by the store
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      {/* Dynamic Background Images */}
      {BACKGROUND_IMAGES.map((img, index) => (
        <div
          key={img}
          className={cn(
            "absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000",
            index === currentImageIndex && !isTransitioning ? "opacity-100" : "opacity-0"
          )}
          style={{ backgroundImage: `url(${img})` }}
        />
      ))}

      {/* Dark Overlay with gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/70 to-black/80" />
      
      {/* Animated gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-cyan-950/50 via-transparent to-blue-950/30" />

      {/* Subtle animated particles/dots */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-4 top-1/4 h-72 w-72 animate-pulse rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -right-4 bottom-1/4 h-72 w-72 animate-pulse rounded-full bg-blue-500/10 blur-3xl" style={{ animationDelay: "1s" }} />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-teal-500/5 blur-3xl" style={{ animationDelay: "2s" }} />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-md px-6 py-12">
        {/* Logo and Brand */}
        <div className="mb-10 flex flex-col items-center text-center">
          {/* Original Logo */}
          <div className="relative mb-6">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" style={{ animationDuration: "3s" }} />
            <div className="relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-3xl bg-white/10 shadow-2xl shadow-cyan-500/30 backdrop-blur-sm">
              <Image
                src="/logo1.png"
                alt="MajiScope Logo"
                width={96}
                height={96}
                className="object-contain rounded-3xl"
                priority
              />
            </div>
          </div>

          <BrandWordmark size="xl" theme="dark" centered className="mb-2" />

          {/* Rotating Slogan - styled as an elegant quotation */}
          <blockquote
            key={currentImageIndex}
            className="mt-5 animate-fade-in max-w-sm text-center font-serif"
          >
            <span aria-hidden="true" className="mr-1.5 text-2xl leading-none text-cyan-200/90">&ldquo;</span>
            <span className="font-bold italic tracking-wide">
              <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-teal-300 bg-clip-text text-transparent drop-shadow-lg">
                {SLOGANS[(currentImageIndex) % SLOGANS.length].first}
              </span>{" "}
              <span className="text-white drop-shadow-lg">
                {SLOGANS[(currentImageIndex) % SLOGANS.length].second}
              </span>
            </span>
            <span aria-hidden="true" className="ml-1.5 text-2xl leading-none text-cyan-200/90">&rdquo;</span>
          </blockquote>
        </div>

        {/* Login Card with Glassmorphism */}
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          {/* Card shine effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent" />
          
          <div className="relative">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white">
                Welcome back
              </h2>
              <p className="mt-1 text-sm text-white/50">
                Sign in to access your dashboard
              </p>
            </div>

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="mb-6 border-red-500/30 bg-red-500/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-red-200">{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm font-medium text-white/70">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@majiscope.go.tz"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    clearError?.()
                  }}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:ring-cyan-400/20"
                  autoComplete="email"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-sm font-medium text-white/70">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      clearError?.()
                    }}
                    className="h-12 rounded-xl border-white/10 bg-white/5 pr-12 text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:ring-cyan-400/20"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Link href="/reset-password" className="font-medium text-cyan-200/80 transition-colors hover:text-cyan-100">
                    Forgot password?
                  </Link>
                  <a href="mailto:support@majiscope.app?subject=MajiScope%20Sign-in%20Help" className="font-medium text-white/55 transition-colors hover:text-white/80">
                    Need help signing in?
                  </a>
                </div>
              </div>

              <Button
                type="submit"
                className="mt-2 h-12 w-full rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-teal-500 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:shadow-cyan-500/40 hover:brightness-110 disabled:opacity-50"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="font-serif text-xs text-white/40">
            <span className="text-white/30">MajiScope</span>
            <span aria-hidden="true" className="mx-1.5 text-white/20">&middot;</span>
            <span className="font-bold italic">
              <span className="text-cyan-200/90">Smart Water.</span>{" "}
              <span className="text-white/70">Informed Management.</span>
            </span>
            <span aria-hidden="true" className="mx-1.5 text-white/20">&middot;</span>
            <span className="text-white/30">Tanzania</span>
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPauseSlideshow((value) => !value)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              {pauseSlideshow || prefersReducedMotion ? "Background paused" : "Pause background"}
            </button>
            <div className="flex items-center justify-center gap-1">
            {BACKGROUND_IMAGES.map((_, index) => (
              <button
                key={index}
                onClick={() => goToSlide(index)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  index === currentImageIndex
                    ? "w-6 bg-cyan-400"
                    : "w-1.5 bg-white/30 hover:bg-white/50"
                )}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}
