import { Skeleton, SkeletonCard, SkeletonText } from './Skeleton';

export const Base = () => (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-3 w-40" />
    <Skeleton className="h-8 w-full" />
    <Skeleton className="size-12 rounded-pill" />
  </div>
);

export const Text = () => (
  <div className="max-w-md">
    <SkeletonText lines={4} />
  </div>
);

export const Cards = () => (
  <div className="flex max-w-md flex-col gap-2">
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard media={false} lines={3} />
  </div>
);
