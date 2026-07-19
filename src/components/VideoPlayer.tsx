"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Minimal video player with NO native controls: browsers draw a darkening
 * scrim over the frame when built-in controls show (hover/pause), which
 * falsifies the clip's color. All controls live in a bar BELOW the video —
 * nothing ever overlays the pixels.
 */
export default function VideoPlayer({
  src,
  autoPlay = false,
  onEnded,
  className = "",
  videoClassName = "max-h-[80vh] w-full",
}: {
  src: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  /** Wrapper classes. */
  className?: string;
  /** Classes for the <video> element itself (sizing per context). */
  videoClassName?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Autoplay via effect: the play() promise rejects quietly if the browser
  // blocks it, and the ▶ button is right there.
  useEffect(() => {
    if (autoPlay) ref.current?.play().catch(() => {});
  }, [autoPlay, src]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seek(e: React.PointerEvent<HTMLDivElement>) {
    const v = ref.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    v.currentTime =
      (Math.min(Math.max(e.clientX - rect.left, 0), rect.width) / rect.width) *
      duration;
  }

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className={className}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={src}
        playsInline
        muted={muted}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={onEnded}
        className={`cursor-pointer bg-black object-contain ${videoClassName}`}
        title={playing ? "Click to pause" : "Click to play"}
      />
      <div className="mt-1 flex shrink-0 items-center gap-2">
        <button
          onClick={toggle}
          className="w-7 shrink-0 border border-border-soft py-0.5 text-center font-mono text-[10px] hover:border-border"
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div
          className="relative h-1.5 min-w-0 flex-1 cursor-pointer bg-border-soft"
          onPointerDown={seek}
          title="Seek"
        >
          <div
            className="absolute left-0 top-0 h-full bg-foreground"
            style={{ width: duration ? `${(time / duration) * 100}%` : 0 }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
          {fmt(time)} / {fmt(duration)}
        </span>
        <button
          onClick={() => setMuted((m) => !m)}
          className="shrink-0 border border-border-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted hover:border-border hover:text-foreground"
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "muted" : "sound"}
        </button>
      </div>
    </div>
  );
}
