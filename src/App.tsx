import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import AppSidebar from "@/components/Sidebar";
import Grid from "@/components/Grid";

export default function App() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
          <AppSidebar />
          <SidebarInset className="flex flex-col overflow-hidden">
            <Grid />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
