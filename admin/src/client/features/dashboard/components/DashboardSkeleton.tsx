import React from 'react';
import { skeletonStyles } from '../dashboard.styles';

export const DashboardSkeleton: React.FC = () => (
  <div className="tt-page tt-page--wide" style={skeletonStyles.container}>
    <div style={skeletonStyles.header}>
      <div style={skeletonStyles.title} />
      <div style={skeletonStyles.subtitle} />
    </div>
    <div style={skeletonStyles.statsGrid}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={skeletonStyles.statCard}>
          <div style={skeletonStyles.statIcon} />
          <div style={skeletonStyles.statValue} />
          <div style={skeletonStyles.statLabel} />
        </div>
      ))}
    </div>
    <div style={skeletonStyles.contentGrid}>
      <div style={skeletonStyles.card}>
        <div style={skeletonStyles.cardTitle} />
        <div style={skeletonStyles.cardContent} />
      </div>
      <div style={skeletonStyles.card}>
        <div style={skeletonStyles.cardTitle} />
        <div style={skeletonStyles.cardContent} />
      </div>
    </div>
  </div>
);
