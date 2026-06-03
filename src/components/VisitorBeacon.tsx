"use client";

import { useEffect } from "react";

const VISITOR_KEY = "reporadar.visitor_id";

function getOrCreateVisitorId(): string | null {
  if (typeof window === "undefined") return null;

  const stored = window.localStorage.getItem(VISITOR_KEY);
  if (stored) return stored;

  const visitorId = crypto.randomUUID();
  window.localStorage.setItem(VISITOR_KEY, visitorId);
  return visitorId;
}

export function VisitorBeacon() {
  useEffect(() => {
    const visitorId = getOrCreateVisitorId();
    if (!visitorId) return;

    const payload = {
      visitorId,
      path: window.location.pathname,
      referrer: document.referrer || null,
      userAgent: navigator.userAgent,
    };

    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });

    if (navigator.sendBeacon("/api/telemetry/visit", blob)) {
      return;
    }

    void fetch("/api/telemetry/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
