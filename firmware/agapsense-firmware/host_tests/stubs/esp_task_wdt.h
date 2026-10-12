#pragma once
#include "sim_hal.h"
inline int esp_task_wdt_reset() { g_hal.wdtResets++; g_hal.wdtAt.push_back(g_hal.now); return 0; }
