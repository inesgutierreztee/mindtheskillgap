import React from 'react';
import { Navigation, Map as MapIcon, User } from 'lucide-react';
import { TabType } from '../types';

interface BottomNavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  hasActiveAlert?: boolean;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  activeTab,
  onChangeTab,
  hasActiveAlert = false,
}) => {
  const navItems = [
    { id: 'home' as TabType, label: 'Journey', icon: Navigation },
    // Service alerts live in the Plan tab, so its badge flags an active disruption.
    { id: 'map' as TabType, label: 'Plan', icon: MapIcon, badge: hasActiveAlert },
    { id: 'more' as TabType, label: 'Profile', icon: User },
  ];

  return (
    <nav
      id="bottom-navigation-bar"
      className="bg-white bg-surface-container-lowest border-t border-outline-variant/30 shadow-sm w-full shrink-0 z-30 select-none px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-3 gap-1 items-center max-w-sm mx-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const IconComponent = item.icon;

          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => onChangeTab(item.id)}
              className={`flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer min-h-[46px] ${
                isActive
                  ? 'text-primary font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <div className="relative">
                <IconComponent
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'stroke-[2.4] scale-105' : 'stroke-[1.8]'
                  }`}
                />
                {item.badge && !isActive && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full ring-2 ring-white" />
                )}
              </div>
              <span
                className={`text-[11px] mt-0.5 tracking-tight ${
                  isActive ? 'text-primary font-bold' : 'text-on-surface-variant font-medium'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* iOS Home Indicator */}
      <div className="w-32 h-1 bg-on-surface/20 rounded-full mx-auto mt-2" />
    </nav>
  );
};
