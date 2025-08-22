import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const useQueryParam = (query:string) => {
  //@ts-expect-error 
  const searchParams = new URLSearchParams(window.location.search);
  const value = searchParams.get(query);
  
  if (value === null) {
    return undefined;
  }
  
  return value;
}