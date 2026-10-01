"use client";
import {SidebarMenuButton, SidebarMenuItem} from "@/components/ui/sidebar";
import {usePathname} from "next/navigation";
import Link from "next/link";

export default function SideBarButton({item}: { item: { title: string; url: string; icon: React.ComponentType } }) {
    const pathname = usePathname();
    // the urls end with a slash (trailingSlash export), compare without it
    const isActive = withoutSlash(pathname) === withoutSlash(item.url);
    return <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild isActive={isActive}>
            <Link href={item.url}>
                <item.icon />
                <span>{item.title}</span>
            </Link>
        </SidebarMenuButton>
    </SidebarMenuItem>
}

const withoutSlash = (path: string) => path.length > 1 ? path.replace(/\/$/, "") : path;