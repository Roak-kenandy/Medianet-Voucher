import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import { operatorApi } from '../../api/client';
import './operator-marketing-ads.css';

const AUTO_ADVANCE_MS = 8000;

export default function OperatorMarketingAds({ ads: adsProp, variant = 'spotlight' }) {
  const [adsLocal, setAdsLocal] = useState([]);
  const [loading, setLoading] = useState(!adsProp);
  const [index, setIndex] = useState(0);

  const ads = adsProp ?? adsLocal;
  const isSpotlight = variant === 'spotlight';

  useEffect(() => {
    if (adsProp) {
      setLoading(false);
      return;
    }
    operatorApi
      .getMarketingAds()
      .then((items) => setAdsLocal(items || []))
      .catch(() => setAdsLocal([]))
      .finally(() => setLoading(false));
  }, [adsProp]);

  useEffect(() => {
    setIndex(0);
  }, [ads.length]);

  const goNext = useCallback(() => {
    setIndex((prev) => (prev + 1) % ads.length);
  }, [ads.length]);

  useEffect(() => {
    if (ads.length <= 1) return undefined;
    const timer = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [ads.length, goNext]);

  if (loading || ads.length === 0) return null;

  const ad = ads[index];

  return (
    <div
      className={`operator-promo${isSpotlight ? ' operator-promo-spotlight' : ''}`}
      aria-label="Promotions from Medianet"
    >
      <div className="operator-promo-visual">
        <div className="operator-promo-frame">
          <div className="operator-promo-slides" aria-live="polite">
            {ads.map((item, i) => {
              const slideImage = (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="operator-promo-image"
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              );
              return (
                <div
                  key={item.id}
                  className={`operator-promo-slide${i === index ? ' is-active' : ''}`}
                  aria-hidden={i !== index}
                >
                  {item.linkUrl ? (
                    <a
                      href={item.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="operator-promo-link"
                    >
                      {slideImage}
                    </a>
                  ) : (
                    slideImage
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {ads.length > 1 && (
          <div className="operator-promo-dots" aria-hidden="true">
            {ads.map((item, i) => (
              <span
                key={item.id}
                className={`operator-promo-dot${i === index ? ' is-active' : ''}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="operator-promo-caption">
        <div className="operator-promo-caption-label">
          <Sparkles size={14} aria-hidden />
          <span>Offers &amp; updates</span>
        </div>
        <h2 className="operator-promo-title">{ad.title}</h2>
        {ad.description && (
          <p className="operator-promo-description">{ad.description}</p>
        )}
        {ad.linkUrl && (
          <a
            href={ad.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="operator-promo-cta btn btn-secondary btn-sm"
          >
            Learn more
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
