/**
 * Browser-persisted UI customization preferences ("Fancy UI" settings):
 * accent color, corner geometry, layout density, surface finish, and motion.
 */

export type AccentPreset = "emerald" | "sky" | "indigo" | "amber" | "rose" | "violet";
export type RadiusPreset = "sharp" | "rounded" | "pill";
export type DensityPreset = "compact" | "balanced" | "spacious";
export type SurfacePreset = "matte" | "frosted" | "elevated";

export type UiPreferences = {
  accent: AccentPreset;
  radius: RadiusPreset;
  density: DensityPreset;
  surface: SurfacePreset;
  motionEnabled: boolean;
  ambientBackdrop: boolean;
};

export const UI_PREFS_STORAGE_KEY = "matches-ui-prefs";

export const DEFAULT_UI_PREFS: UiPreferences = {
  accent: "emerald",
  radius: "rounded",
  density: "balanced",
  surface: "frosted",
  motionEnabled: true,
  ambientBackdrop: true,
};

export const ACCENT_SWATCHES: Record<AccentPreset, { light: string; dark: string; soft: string; ring: string }> = {
  emerald: { light: "#059669", dark: "#10b981", soft: "rgba(16, 185, 129, 0.14)", ring: "rgba(16, 185, 129, 0.35)" },
  sky: { light: "#0284c7", dark: "#38bdf8", soft: "rgba(14, 165, 233, 0.14)", ring: "rgba(14, 165, 233, 0.35)" },
  indigo: { light: "#4f46e5", dark: "#818cf8", soft: "rgba(99, 102, 241, 0.14)", ring: "rgba(99, 102, 241, 0.35)" },
  amber: { light: "#d97706", dark: "#f59e0b", soft: "rgba(245, 158, 11, 0.15)", ring: "rgba(245, 158, 11, 0.35)" },
  rose: { light: "#e11d48", dark: "#fb7185", soft: "rgba(244, 63, 94, 0.14)", ring: "rgba(244, 63, 94, 0.35)" },
  violet: { light: "#7c3aed", dark: "#a78bfa", soft: "rgba(139, 92, 246, 0.14)", ring: "rgba(139, 92, 246, 0.35)" },
};

const VALID_ACCENTS = new Set<string>(["emerald", "sky", "indigo", "amber", "rose", "violet"]);
const VALID_RADII = new Set<string>(["sharp", "rounded", "pill"]);
const VALID_DENSITIES = new Set<string>(["compact", "balanced", "spacious"]);
const VALID_SURFACES = new Set<string>(["matte", "frosted", "elevated"]);

export function normalizeUiPreferences(raw: unknown): UiPreferences {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_PREFS };
  const obj = raw as Record<string, unknown>;
  return {
    accent: typeof obj.accent === "string" && VALID_ACCENTS.has(obj.accent) ? (obj.accent as AccentPreset) : DEFAULT_UI_PREFS.accent,
    radius: typeof obj.radius === "string" && VALID_RADII.has(obj.radius) ? (obj.radius as RadiusPreset) : DEFAULT_UI_PREFS.radius,
    density:
      typeof obj.density === "string" && VALID_DENSITIES.has(obj.density)
        ? (obj.density as DensityPreset)
        : DEFAULT_UI_PREFS.density,
    surface:
      typeof obj.surface === "string" && VALID_SURFACES.has(obj.surface)
        ? (obj.surface as SurfacePreset)
        : DEFAULT_UI_PREFS.surface,
    motionEnabled: typeof obj.motionEnabled === "boolean" ? obj.motionEnabled : DEFAULT_UI_PREFS.motionEnabled,
    ambientBackdrop: typeof obj.ambientBackdrop === "boolean" ? obj.ambientBackdrop : DEFAULT_UI_PREFS.ambientBackdrop,
  };
}

export function applyUiPreferencesToRoot(prefs: UiPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.accent = prefs.accent;
  root.dataset.radius = prefs.radius;
  root.dataset.density = prefs.density;
  root.dataset.surface = prefs.surface;
  root.dataset.motion = prefs.motionEnabled ? "on" : "off";
  root.dataset.ambient = prefs.ambientBackdrop ? "on" : "off";
}
