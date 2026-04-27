"use client";

import { motion, type MotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { fadeInUp, staggerContainer } from "@/lib/motion";

interface FadeInProps extends MotionProps {
  children: ReactNode;
  className?: string;
  /** Stagger children by lib/motion.ts staggerChildren. */
  stagger?: boolean;
  /** Delay (s) before this element animates in. */
  delay?: number;
}

export function FadeIn({
  children,
  className,
  stagger = false,
  delay = 0,
  ...rest
}: FadeInProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={stagger ? staggerContainer : fadeInUp}
      transition={{ delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function FadeInItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={fadeInUp} className={className}>
      {children}
    </motion.div>
  );
}
