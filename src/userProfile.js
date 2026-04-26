const STORAGE_KEY = "quiz-user-profile";

export function getUserProfile() {
  if (typeof window === "undefined") return { name: "", avatar: "" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: "", avatar: "" };
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || "",
      avatar: parsed.avatar || "",
    };
  } catch {
    return { name: "", avatar: "" };
  }
}

export function saveUserProfile(profile) {
  if (typeof window === "undefined") return;
  try {
    const current = getUserProfile();
    const next = {
      ...current,
      ...profile,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

