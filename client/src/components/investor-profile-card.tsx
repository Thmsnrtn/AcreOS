import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, Star, MapPin, Briefcase, Handshake } from 'lucide-react';

interface InvestorProfileCardProps {
  profile: {
    id: number;
    displayName: string;
    bio?: string | null;
    location?: string | null;
    specialties?: string[] | null;
    preferredStates?: string[] | null;
    dealsClosed?: number | null;
    rating?: string | number | null;
    reviewCount?: number | null;
    isVerified?: boolean | null;
    reliabilityScore?: string | number | null;
  };
  orgName?: string;
  onConnect?: (profileId: number) => void;
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  return (
    <span className="flex items-center gap-0.5" title={`${rating.toFixed(1)} / 5`}>
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f${i}`} className="w-3 h-3 fill-amber-400 text-amber-400" />
      ))}
      {half && <Star key="h" className="w-3 h-3 fill-amber-200 text-amber-400" />}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e${i}`} className="w-3 h-3 text-muted-foreground/40" />
      ))}
    </span>
  );
}

export function InvestorProfileCard({ profile, orgName, onConnect }: InvestorProfileCardProps) {
  const rating = profile.rating ? parseFloat(profile.rating.toString()) : null;
  const dealsClosed = profile.dealsClosed ?? 0;
  const specialties = profile.specialties ?? [];
  const preferredStates = profile.preferredStates ?? [];

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <CardTitle className="text-base">{profile.displayName}</CardTitle>
              {profile.isVerified && (
                <CheckCircle
                  className="w-4 h-4 text-blue-500 shrink-0"
                  aria-label="Verified investor"
                />
              )}
            </div>
            {orgName && (
              <CardDescription className="mt-0.5">{orgName}</CardDescription>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onConnect?.(profile.id)}
          >
            <Handshake className="w-3.5 h-3.5 mr-1.5" />
            Connect
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {profile.bio && (
          <p className="text-sm text-muted-foreground line-clamp-2">{profile.bio}</p>
        )}

        {/* Location */}
        {profile.location && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {profile.location}
          </div>
        )}

        {/* Specialties */}
        {specialties.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Briefcase className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {specialties.map((s) => (
                <Badge key={s} variant="secondary" className="text-xs py-0 px-1.5 capitalize">
                  {s.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Preferred states */}
        {preferredStates.length > 0 && (
          <div className="flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {preferredStates.map((s) => (
                <Badge key={s} variant="outline" className="text-xs py-0 px-1.5 font-mono">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 pt-1 border-t text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Handshake className="w-3.5 h-3.5" />
            <strong className="text-foreground">{dealsClosed}</strong>
            &nbsp;deal{dealsClosed !== 1 ? 's' : ''} closed
          </span>
          {rating !== null && (
            <span className="flex items-center gap-1.5">
              <StarRating rating={rating} />
              <span>{rating.toFixed(1)}</span>
              {profile.reviewCount != null && profile.reviewCount > 0 && (
                <span className="text-muted-foreground">({profile.reviewCount})</span>
              )}
            </span>
          )}
          {profile.isVerified && (
            <span className="ml-auto flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
              <CheckCircle className="w-3 h-3" />
              Verified
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
