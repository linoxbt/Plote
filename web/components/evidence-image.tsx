"use client";

import Image from "next/image";
import { isOptimizableImage } from "@/lib/images";

/**
 * A lazy, resized thumbnail of an evidence photo. Supabase-hosted photos go through next/image (a few dozen KB
 * instead of a multi-MB original); anything else falls back to a plain lazy <img>. The proof page links the original.
 */
export function EvidenceThumb({ src, alt, className, sizes = "(max-width: 640px) 50vw, 320px", width = 640, height = 480 }: { src: string; alt: string; className?: string; sizes?: string; width?: number; height?: number }) {
  if (isOptimizableImage(src)) return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className={className} loading="lazy" />;
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
}
