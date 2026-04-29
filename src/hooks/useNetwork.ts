import { useEffect, useState } from "react";

export function useNetwork() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    setIsConnected(true);
  }, []);

  return { isConnected };
}
