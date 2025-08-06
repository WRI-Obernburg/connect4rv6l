import { cn } from "@/lib/utils";

export default function ConnectedIndicator(props: { isConnected: boolean }) {
    return <div className={cn("w-4 h-4 rounded-full",props.isConnected?"bg-green-500":"bg-red-600")} />
}