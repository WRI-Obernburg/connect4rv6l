"use client";
import {Calendar, Home, Inbox, MonitorCog, Orbit, Search, Settings, ShieldAlert, SquareChartGantt, Gamepad} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"
import {usePathname} from "next/navigation";
import SideBarButton from "@/components/SideBarButton";

// Menu items.
const items = [
    {
        title: "Overview",
        url: "/",
        icon: SquareChartGantt ,
    },
    {
        title: "State",
        url: "/state",
        icon: Orbit,
    },
    {
        title: "Error Log",
        url: "/error-log",
        icon: ShieldAlert,
    },
    {
        title: "Manual Control",
        url: "/control",
        icon: MonitorCog,
    },
    {
        title: "Game",
        url: "/game",
        icon: Gamepad,
    },
]

export function AppSidebar() {
    return (
        <Sidebar>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>RV6L Controlpanel</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SideBarButton key={item.title} item={item} />
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}