"use client";

import React from "react";

interface AyoliaLogoProps {
  size?: number;
  className?: string;
  speed?: "normal" | "fast";
  isLoading?: boolean;
}

export default function AyoliaLogo({
  size = 36,
  className = "",
  speed = "normal",
  isLoading = false,
}: AyoliaLogoProps) {
  const isFast = speed === "fast" || isLoading;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`ayolia-logo ${isFast ? "ayolia-logo--fast" : ""} ${isLoading ? "ayolia-logo--loading" : ""} ${className}`.trim()}
      aria-label="Ayolia Logo"
      role="img"
    >
      <defs>
        {/* Gradientes Dourados (Luz e Sombra 3D) */}
        <linearGradient id="ayolia-gold-bright" x1="20" y1="30" x2="100" y2="150" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF08A" />
          <stop offset="45%" stopColor="#FAD155" />
          <stop offset="100%" stopColor="#E59A28" />
        </linearGradient>

        <linearGradient id="ayolia-gold-mid" x1="60" y1="35" x2="135" y2="155" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FCE068" />
          <stop offset="55%" stopColor="#EDA333" />
          <stop offset="100%" stopColor="#C9781A" />
        </linearGradient>

        <linearGradient id="ayolia-gold-dark" x1="95" y1="40" x2="165" y2="165" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DF9226" />
          <stop offset="55%" stopColor="#C57419" />
          <stop offset="100%" stopColor="#9E560E" />
        </linearGradient>

        {/* Gradientes da Gema Esmeralda Central */}
        <linearGradient id="ayolia-gem-light" x1="92" y1="80" x2="102" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="50%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>

        <linearGradient id="ayolia-gem-dark" x1="100" y1="82" x2="109" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="55%" stopColor="#047857" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>
      </defs>

      {/* ============================================================ */}
      {/* ASA ESQUERDA (wing-left)                                     */}
      {/* ============================================================ */}
      <g className="wing-left" id="wing-left">
        {/* Pena Superior Principal (Sombra/Base inferior + Faceta iluminada superior) */}
        <path
          d="M26 36 C23 64, 42 84, 65 96 C78 103, 83 114, 75 128 C82 118, 86 104, 82 90 C78 76, 62 67, 47 57 C36 50, 30 43, 26 36 Z"
          fill="url(#ayolia-gold-dark)"
        />
        <path
          d="M26 36 C33 52, 49 62, 66 71 C79 78, 84 91, 82 108 C80 116, 77 123, 75 128 C78 113, 73 100, 59 91 C42 81, 27 65, 26 36 Z"
          fill="url(#ayolia-gold-bright)"
        />

        {/* Pena Média Secundária */}
        <path
          d="M23 65 C23 89, 41 105, 61 114 C68 117, 71 122, 71 128 C73 118, 69 107, 57 100 C42 91, 29 81, 23 65 Z"
          fill="url(#ayolia-gold-dark)"
        />
        <path
          d="M23 65 C30 78, 44 87, 59 95 C69 100, 73 110, 71 124 C68 116, 61 110, 51 105 C36 98, 25 85, 23 65 Z"
          fill="url(#ayolia-gold-bright)"
        />

        {/* Pena Inferior + Perna Esquerda do "A" */}
        <path
          d="M32 98 C35 114, 48 122, 59 125 C65 127, 67 132, 63 141 C57 152, 49 158, 42 160 C49 148, 55 136, 58 126 L63 134 C65 126, 61 120, 52 116 C41 112, 34 106, 32 98 Z"
          fill="url(#ayolia-gold-dark)"
        />
        <path
          d="M32 98 C39 105, 49 109, 59 113 C68 117, 73 126, 71 138 C69 150, 57 159, 42 160 C53 155, 62 145, 64 133 C65 125, 60 120, 50 116 C39 112, 34 106, 32 98 Z"
          fill="url(#ayolia-gold-bright)"
        />
        {/* Lâmina interna da perna esquerda */}
        <path
          d="M58 126 L64 134 C61 146, 53 156, 42 160 L58 126 Z"
          fill="url(#ayolia-gold-mid)"
        />
      </g>

      {/* ============================================================ */}
      {/* ASA DIREITA (wing-right) - Espelhamento Simétrico em X=100   */}
      {/* ============================================================ */}
      <g className="wing-right" id="wing-right">
        <g transform="translate(200, 0) scale(-1, 1)">
          {/* Pena Superior Principal */}
          <path
            d="M26 36 C23 64, 42 84, 65 96 C78 103, 83 114, 75 128 C82 118, 86 104, 82 90 C78 76, 62 67, 47 57 C36 50, 30 43, 26 36 Z"
            fill="url(#ayolia-gold-dark)"
          />
          <path
            d="M26 36 C33 52, 49 62, 66 71 C79 78, 84 91, 82 108 C80 116, 77 123, 75 128 C78 113, 73 100, 59 91 C42 81, 27 65, 26 36 Z"
            fill="url(#ayolia-gold-bright)"
          />

          {/* Pena Média Secundária */}
          <path
            d="M23 65 C23 89, 41 105, 61 114 C68 117, 71 122, 71 128 C73 118, 69 107, 57 100 C42 91, 29 81, 23 65 Z"
            fill="url(#ayolia-gold-dark)"
          />
          <path
            d="M23 65 C30 78, 44 87, 59 95 C69 100, 73 110, 71 124 C68 116, 61 110, 51 105 C36 98, 25 85, 23 65 Z"
            fill="url(#ayolia-gold-bright)"
          />

          {/* Pena Inferior + Perna Direita do "A" */}
          <path
            d="M32 98 C35 114, 48 122, 59 125 C65 127, 67 132, 63 141 C57 152, 49 158, 42 160 C49 148, 55 136, 58 126 L63 134 C65 126, 61 120, 52 116 C41 112, 34 106, 32 98 Z"
            fill="url(#ayolia-gold-dark)"
          />
          <path
            d="M32 98 C39 105, 49 109, 59 113 C68 117, 73 126, 71 138 C69 150, 57 159, 42 160 C53 155, 62 145, 64 133 C65 125, 60 120, 50 116 C39 112, 34 106, 32 98 Z"
            fill="url(#ayolia-gold-bright)"
          />
          {/* Lâmina interna da perna direita */}
          <path
            d="M58 126 L64 134 C61 146, 53 156, 42 160 L58 126 Z"
            fill="url(#ayolia-gold-mid)"
          />
        </g>
      </g>

      {/* ============================================================ */}
      {/* NÚCLEO CENTRAL (center-core): Estrutura "A" + Gema Verde     */}
      {/* ============================================================ */}
      <g className="center-core" id="center-core">
        {/* Metade Esquerda do Losango Central "A" (Iluminada) */}
        <path
          d="M100 34 L78 82 C84 91, 85 104, 80 116 L100 144 L100 125 L87 103 L100 75 Z"
          fill="url(#ayolia-gold-bright)"
        />
        {/* Faceta Interna Esquerda (Bisel Médio) */}
        <path
          d="M100 56 L82 95 L80 116 L100 144 L100 125 L87 103 L100 75 Z"
          fill="url(#ayolia-gold-mid)"
          opacity="0.85"
        />

        {/* Metade Direita do Losango Central "A" (Sombreada 3D) */}
        <path
          d="M100 34 L122 82 C116 91, 115 104, 120 116 L100 144 L100 125 L113 103 L100 75 Z"
          fill="url(#ayolia-gold-mid)"
        />
        {/* Faceta Interna Direita (Bisel Escuro) */}
        <path
          d="M100 56 L118 95 L120 116 L100 144 L100 125 L113 103 L100 75 Z"
          fill="url(#ayolia-gold-dark)"
        />

        {/* Gema Esmeralda Central Facetada */}
        <g className="emerald-gem">
          {/* Faceta Esquerda Iluminada */}
          <polygon
            points="100,83 94,97 94,108 100,117"
            fill="url(#ayolia-gem-light)"
          />
          {/* Faceta Direita Sombreada */}
          <polygon
            points="100,83 106,97 106,108 100,117"
            fill="url(#ayolia-gem-dark)"
          />
          {/* Mesa Central da Esmeralda */}
          <polygon
            points="100,89 96.5,98 96.5,106 100,112 103.5,106 103.5,98"
            fill="#10B981"
            opacity="0.65"
          />
          {/* Brilho Superior */}
          <polygon
            points="100,83 94,97 100,94"
            fill="#A7F3D0"
            opacity="0.75"
          />
        </g>
      </g>
    </svg>
  );
}
