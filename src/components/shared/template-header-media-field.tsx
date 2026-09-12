'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  uploadAccountMedia,
  uploadAdminTemplateMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { cn } from '@/lib/utils';

type MediaHeaderFormat = 'image' | 'video' | 'document';

interface TemplateHeaderMediaFieldProps {
  headerFormat: MediaHeaderFormat;
  value: string;
  onChange: (url: string) => void;
  /** Brand-scoped upload (Settings → Templates). Default. */
  uploadScope?: 'brand' | 'admin';
  /** i18n strings — pass from useTranslations when available. */
  labels?: {
    uploadImage?: string;
    uploadHint?: string;
    imageHint?: string;
    mediaHint?: string;
    videoHint?: string;
    documentHint?: string;
    mediaUrlPlaceholder?: string;
    pasteUrlInstead?: string;
    useUploadInstead?: string;
    toastInvalidImage?: string;
    toastImageTooLarge?: string;
    toastUploadSuccess?: string;
    toastUploadFailed?: string;
  };
  className?: string;
}

const DEFAULT_LABELS = {
  uploadImage: 'Upload image',
  uploadHint: 'JPEG or PNG, ≤5 MB',
  imageHint:
    'Upload a JPEG/PNG (≤5 MB, ≥800×418 px recommended). We store a public link and send the image to Meta when you submit.',
  mediaHint:
    'Must be a publicly accessible HTTPS link. Meta fetches it once during review, so it needs to stay live for ~24 hrs.',
  videoHint: ' Recommended: MP4 / 3GPP, ≤16 MB, ≤60 seconds.',
  documentHint: ' Recommended: PDF, ≤100 MB.',
  mediaUrlPlaceholder: 'https://… (public {format} link)',
  pasteUrlInstead: 'Paste a public link instead',
  useUploadInstead: 'Upload a file instead',
  toastInvalidImage: 'Header image must be JPEG or PNG.',
  toastImageTooLarge: 'Image is too large ({size} MB). Max is 5 MB.',
  toastUploadSuccess: 'Image uploaded',
  toastUploadFailed: 'Upload failed',
};

export function TemplateHeaderMediaField({
  headerFormat,
  value,
  onChange,
  uploadScope = 'brand',
  labels: labelOverrides,
  className,
}: TemplateHeaderMediaFieldProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const trimmed = value.trim();
  const isImage = headerFormat === 'image';

  async function handleImageFile(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error(labels.toastInvalidImage);
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        labels.toastImageTooLarge!.replace(
          '{size}',
          (file.size / 1024 / 1024).toFixed(1),
        ),
      );
      return;
    }

    setUploading(true);
    try {
      const { publicUrl } =
        uploadScope === 'admin'
          ? await uploadAdminTemplateMedia(file)
          : await uploadAccountMedia('chat-media', file);
      onChange(publicUrl);
      setShowUrlInput(false);
      toast.success(labels.toastUploadSuccess);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : labels.toastUploadFailed,
      );
    } finally {
      setUploading(false);
    }
  }

  if (isImage) {
    return (
      <div className={cn('space-y-2', className)}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImageFile(file);
            e.target.value = '';
          }}
        />

        {trimmed ? (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={trimmed}
              alt="Header preview"
              className="size-16 shrink-0 rounded-lg border border-border object-cover"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="truncate text-xs text-muted-foreground">{trimmed}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Replace image
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange('')}
                  className="text-muted-foreground"
                >
                  <X className="size-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors',
              'hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {uploading ? (
              <Loader2 className="size-8 animate-spin text-primary" />
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">
              {labels.uploadImage}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {labels.uploadHint}
            </span>
          </button>
        )}

        {!trimmed && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-[11px] text-muted-foreground"
            onClick={() => setShowUrlInput((v) => !v)}
          >
            {showUrlInput ? labels.useUploadInstead : labels.pasteUrlInstead}
          </Button>
        )}

        {showUrlInput && !trimmed ? (
          <Input
            placeholder={labels.mediaUrlPlaceholder!.replace(
              '{format}',
              headerFormat,
            )}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
          />
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {labels.imageHint}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        placeholder={labels.mediaUrlPlaceholder!.replace('{format}', headerFormat)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {labels.mediaHint}
        {headerFormat === 'video' ? labels.videoHint : null}
        {headerFormat === 'document' ? labels.documentHint : null}
      </p>
    </div>
  );
}
