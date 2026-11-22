import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { collection, limit, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import {
  db,
  DONATION_SUPPORTERS_COLLECTION,
  handleFirestoreError,
  OperationType,
} from '../firebase';

export interface SupporterFeedItem {
  id: string;
  donorName: string;
  donorAvatar: string;
  amount: number;
  verificationStatus: 'pending_verification' | 'verified';
  createdAtMs: number;
}

const DISPLAY_INTERVAL_MS = 2600; // >= 1.5s clearly visible pause before vertical transition

/**
 * Real-Time Live Homepage Supporter Activity Carousel backed by Firestore onSnapshot.
 * Syncs immediately across all mobile and desktop devices as soon as any supporter
 * voluntarily submits their name and photo (whether pending_verification or verified).
 * Never populates dummy or fake entries.
 */
export const DonationActivityCarousel: React.FC = () => {
  const prefersReducedMotion = useReducedMotion();
  const [supporters, setSupporters] = useState<SupporterFeedItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  useEffect(() => {
    const q = query(
      collection(db, DONATION_SUPPORTERS_COLLECTION),
      where('publicConsent', '==', true),
      limit(30)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const liveItems: SupporterFeedItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const donorName = typeof data?.donorName === 'string' ? data.donorName.trim() : '';
          const donorAvatar = typeof data?.donorAvatar === 'string' ? data.donorAvatar.trim() : '';
          const amount = typeof data?.amount === 'number' && Number.isFinite(data.amount) ? data.amount : 0;
          const verificationStatus =
            data?.verificationStatus === 'verified' ? 'verified' : 'pending_verification';

          let createdAtMs = Date.now();
          if (data?.createdAt instanceof Timestamp) {
            createdAtMs = data.createdAt.toMillis();
          } else if (data?.createdAt && typeof data.createdAt.seconds === 'number') {
            createdAtMs = data.createdAt.seconds * 1000;
          }

          if (donorName && donorAvatar) {
            liveItems.push({
              id: docSnap.id,
              donorName,
              donorAvatar,
              amount,
              verificationStatus,
              createdAtMs,
            });
          }
        });

        // Sort newest first in JS (avoids requiring a composite Firestore index)
        liveItems.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setSupporters(liveItems);
        setActiveIndex((prev) => (liveItems.length === 0 ? 0 : prev % liveItems.length));
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, DONATION_SUPPORTERS_COLLECTION);
        } catch {
          // Structured FirestoreErrorInfo already logged; fail gracefully without crashing UI
        }
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (supporters.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % supporters.length);
    }, DISPLAY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [supporters.length]);

  if (supporters.length === 0) {
    return null;
  }

  const currentSupporter = supporters[activeIndex % supporters.length];

  return (
    <section
      aria-label="Recent supporters"
      className="relative z-10 w-full max-w-[440px] mt-4"
    >
      <div className="relative h-[74px] w-full overflow-hidden rounded-[22px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentSupporter.id}
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 28, scale: 0.92, filter: 'blur(3px)' }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -28, scale: 0.88, filter: 'blur(4px)' }
            }
            transition={{
              duration: prefersReducedMotion ? 0.2 : 0.48,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="liquid-glass-menu absolute inset-0 rounded-[22px] px-4 py-3 flex items-center gap-3.5 shadow-[0_14px_30px_-10px_rgba(95,70,40,0.28)]"
          >
            <div className="glass-glow-rim" aria-hidden="true" />

            {/* Left Side: Supporter Profile Picture */}
            <div className="relative h-12 w-12 shrink-0 rounded-full p-[2px] bg-gradient-to-br from-white via-[#f3e5cd] to-[#b8976b] shadow-sm">
              <img
                src={currentSupporter.donorAvatar}
                alt={currentSupporter.donorName}
                className="h-full w-full rounded-full object-cover object-center bg-[#f4ead9] select-none"
              />
              {currentSupporter.verificationStatus === 'verified' && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-[#f3e8d7]"
                  title="Verified supporter"
                >
                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </div>

            {/* Right Side: Supporter Name + Donation Amount in INR */}
            <div className="min-w-0 flex-1 flex items-center justify-between gap-3 text-left">
              <div className="min-w-0 flex flex-col">
                <p className="truncate font-['Outfit',sans-serif] font-extrabold text-sm sm:text-[15px] text-[#241407] leading-tight">
                  {currentSupporter.donorName}
                </p>
                <span className="text-[11px] font-semibold text-[#75583d] leading-snug">
                  {currentSupporter.verificationStatus === 'verified'
                    ? 'Verified supporter'
                    : 'Recent supporter'}
                </span>
              </div>

              <div className="shrink-0 text-right">
                {currentSupporter.amount > 0 ? (
                  <span className="font-['Outfit',sans-serif] font-black text-base sm:text-[17px] text-[#261508] tabular-nums tracking-tight">
                    ₹{currentSupporter.amount.toLocaleString('en-IN')}
                  </span>
                ) : (
                  <span className="font-['Outfit',sans-serif] font-bold text-xs text-[#6d5138]">
                    Donated
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
};
