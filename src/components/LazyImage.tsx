import { useEffect, useRef, useState } from "react";

interface LazyImageProps {
  src: string;
  width?: number;
  height?: number;
  alt?: string;
  className?: string;
  draggable?: boolean;
}

export function LazyImage({ src, width, height, alt = "", className, draggable = false }: LazyImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [inView, setInView] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (error) {
    return (
      <div className="flex min-h-[80px] w-full items-center justify-center text-xs text-muted-foreground">
        Missing
      </div>
    );
  }

  return (
    <img
      ref={ref}
      src={inView ? src : "data:,"}
      width={width}
      height={height}
      alt={alt}
      className={className}
      draggable={draggable}
      onError={() => setError(true)}
    />
  );
}
