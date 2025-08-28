"use client";
import {Calendar, Home, Inbox, MonitorCog, Monitor, Orbit, Search, Settings, ShieldAlert, SquareChartGantt, Gamepad, Package, Info} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"
import {usePathname} from "next/navigation";
import SideBarButton from "@/components/SideBarButton";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogDescription, DialogTrigger } from "@radix-ui/react-dialog";
import { Button } from "./ui/button";

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
    {
        title: "Display",
        url: "/display",
        icon: Monitor,
    },
    {
        title: "Architecture",
        url: "/architecture",
        icon: Package
    }
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
            <SidebarFooter>
                <Dialog>
                    <DialogTrigger asChild>
                        <SidebarMenuButton className="cursor-pointer">
                            <Info className="h-4 w-4" />
                            About
                        </SidebarMenuButton>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Über 4-Gewinnt</DialogTitle>
                            <DialogDescription>
                                Dieses Projekt dient als Demoanwendung für den RV6L im Walter Reis Insitut.
                                <br />
                                Dabei tritt ein Spieler gegen einen künstliche Intelligenz an, die auf dem Backend implementiert ist.
                                <br />
                                <br />
                                © 2025 Tim Arnold
                            </DialogDescription>
                        </DialogHeader>
                        {/* Settings content goes here */}
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button className="cursor-pointer">Schließen</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </SidebarFooter>
        </Sidebar>
    )
}