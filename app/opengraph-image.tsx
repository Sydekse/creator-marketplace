import { ImageResponse } from 'next/og';

export const runtime = 'edge';

/**
 * OG image for the root page (served at /opengraph-image).
 * 1200×630, editorial monochrome + teal accent matching the landing page.
 */
export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: 1200,
        height: 630,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'DM Sans', sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle grid texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: 48,
          zIndex: 1,
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Brand mark */}
            <div style={{ position: 'relative', width: 28, height: 28 }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  backgroundColor: '#171717',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  backgroundColor: '#a1a1aa',
                }}
              />
            </div>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: '#171717',
                letterSpacing: -0.3,
              }}
            >
              Creator Marketplace
            </span>
          </div>
          <div
            style={{
              background: '#171717',
              color: '#fafafa',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 16px',
              borderRadius: 999,
              letterSpacing: 0.5,
            }}
          >
            TikTok creator deals, simplified
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            gap: 60,
            flex: 1,
            alignItems: 'center',
          }}
        >
          {/* Left */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: '#166b63',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase' as const,
                marginBottom: 12,
              }}
            >
              For brands &amp; creators
            </div>
            <div
              style={{
                fontFamily: "'Noto Serif', Georgia, serif",
                fontSize: 52,
                fontWeight: 700,
                color: '#171717',
                lineHeight: 1.08,
                letterSpacing: -1.5,
                marginBottom: 16,
              }}
            >
              Where TikTok deals
              <br />
              get{' '}
              <span style={{ fontStyle: 'italic', color: '#166b63' }}>
                done
              </span>
            </div>
            <div
              style={{
                fontSize: 17,
                color: '#525252',
                lineHeight: 26,
                maxWidth: 420,
                marginBottom: 28,
              }}
            >
              Post a deal, match with vetted creators, ship content. Payment
              releases on approval. Escrow holds every deal safe.
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 32 }}>
              {[
                { value: '85%', label: 'Creator payout' },
                { value: '15%', label: 'Platform fee' },
                { value: '24h', label: 'Avg. payout time' },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <span
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: '#171717',
                      letterSpacing: -0.7,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s.value}
                  </span>
                  <span style={{ fontSize: 11, color: '#737373' }}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right - app mockup */}
          <div style={{ width: 360, flexShrink: 0 }}>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e5e5e5',
                borderRadius: 16,
                overflow: 'hidden',
                boxShadow:
                  '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px -4px rgba(0,0,0,0.08), 0 24px 48px -8px rgba(0,0,0,0.12)',
              }}
            >
              {/* Mockup header */}
              <div
                style={{
                  background: '#171717',
                  padding: '14px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{ position: 'relative', width: 16, height: 16 }}>
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 9,
                      height: 9,
                      borderRadius: 3,
                      backgroundColor: '#fafafa',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      width: 9,
                      height: 9,
                      borderRadius: 3,
                      backgroundColor: '#a1a1aa',
                    }}
                  />
                </div>
                <span
                  style={{
                    color: '#fafafa',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Creator Marketplace
                </span>
              </div>

              {/* Mockup body */}
              <div style={{ padding: 20 }}>
                <div
                  style={{
                    color: '#166b63',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase' as const,
                    marginBottom: 6,
                  }}
                >
                  Campaigns
                </div>
                <div
                  style={{
                    fontFamily: "'Noto Serif', Georgia, serif",
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#171717',
                    marginBottom: 12,
                    lineHeight: 20,
                  }}
                >
                  Active campaigns
                </div>

                {/* Campaign cards */}
                {[
                  {
                    name: 'Ramadan Beauty Push',
                    meta: '3 videos · 15,000 ETB',
                    chip: 'Active',
                    chipBg: '#dcf5f2',
                    chipColor: '#166b63',
                  },
                  {
                    name: 'Fitness January',
                    meta: '2 videos · 8,000 ETB',
                    chip: 'Pending',
                    chipBg: '#fef3c7',
                    chipColor: '#92400e',
                  },
                  {
                    name: 'Tech Launch Week',
                    meta: '4 videos · 22,000 ETB',
                    chip: 'Active',
                    chipBg: '#dcf5f2',
                    chipColor: '#166b63',
                  },
                ].map((c) => (
                  <div
                    key={c.name}
                    style={{
                      background: '#f5f5f4',
                      border: '1px solid #e5e5e5',
                      borderRadius: 10,
                      padding: '10px 14px',
                      marginBottom: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#171717',
                        }}
                      >
                        {c.name}
                      </span>
                      <span style={{ fontSize: 9, color: '#737373' }}>
                        {c.meta}
                      </span>
                    </div>
                    <div
                      style={{
                        background: c.chipBg,
                        color: c.chipColor,
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 999,
                      }}
                    >
                      {c.chip}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            paddingTop: 16,
            borderTop: '1px solid #e5e5e5',
            marginTop: 'auto',
          }}
        >
          <span style={{ fontSize: 13, color: '#737373', letterSpacing: 0.3 }}>
            creator-marketplace.vercel.app
          </span>
          <div
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              backgroundColor: '#d4d4d4',
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: '#a3a3a3',
              fontStyle: 'italic',
              fontFamily: "'Noto Serif', Georgia, serif",
            }}
          >
            Escrow-backed creator campaigns
          </span>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
