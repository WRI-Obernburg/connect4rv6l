"use client";
import {SidebarMenuButton, SidebarMenuItem} from "@/components/ui/sidebar";
import {usePathname} from "next/navigation";
import Link from "next/link";

export default function SideBarButton({item}: { item: { title: string; url: string; icon: React.ComponentType } }) {
    const pathname = usePathname();
    const isActive = pathname === item.url;
    return <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild isActive={isActive}>
            <Link href={item.url}>
                <item.icon />
                <span>{item.title}</span>
            </Link>
        </SidebarMenuButton>
    </SidebarMenuItem>
}