/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Card — surface container with unified radius, border, shadow and padding.
 */
import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const paddings = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', interactive, className = '', children, ...rest }, ref) => (
    <div
      ref={ref}
      className={
        'bg-white rounded-lg border border-slate-100 shadow-sm ' +
        paddings[padding] +
        (interactive ? ' transition-all duration-150 ease-out hover:shadow-md hover:-translate-y-0.5 ' : ' ') +
        className
      }
      {...rest}
    >
      {children}
    </div>
  ),
);
Card.displayName = 'Card';
