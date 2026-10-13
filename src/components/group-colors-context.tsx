"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GroupColorMap } from "@/lib/group-color";

const GroupColorsContext = createContext<GroupColorMap>({});

/** Makes the stored group colors available to every view below it. */
export function GroupColorsProvider({
  colors,
  children,
}: {
  colors: GroupColorMap;
  children: ReactNode;
}) {
  return (
    <GroupColorsContext.Provider value={colors}>
      {children}
    </GroupColorsContext.Provider>
  );
}

/** The stored group colors; resolve one with `resolveGroupColor`. */
export function useGroupColors(): GroupColorMap {
  return useContext(GroupColorsContext);
}
