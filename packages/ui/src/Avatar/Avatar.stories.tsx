import { Avatar } from './Avatar';

const PHOTO = 'https://i.pravatar.cc/120?img=12';

export const WithPhoto = () => (
  <div className="flex items-end gap-4">
    <Avatar src={PHOTO} name="Ana Lima" size="sm" />
    <Avatar src={PHOTO} name="Ana Lima" size="md" />
    <Avatar src={PHOTO} name="Ana Lima" size="lg" />
  </div>
);

export const InitialsFallback = () => (
  <div className="flex items-end gap-4">
    <Avatar name="Ana Lima" size="sm" />
    <Avatar name="Bruno Castro" size="md" />
    <Avatar name="Carla" size="lg" />
    <Avatar name={null} size="md" />
  </div>
);

export const BrokenImageFallsBack = () => (
  <div className="flex items-end gap-4">
    <Avatar src="https://invalid.example/broken.png" name="Ana Lima" size="sm" />
    <Avatar src="https://invalid.example/broken.png" name="Bruno Castro" size="md" />
    <Avatar src="https://invalid.example/broken.png" name="Carla Dias" size="lg" />
  </div>
);
