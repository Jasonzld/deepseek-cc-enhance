# HD240BB-V6 Netlist Prompt Block

Use this block when asking DeepSeek to correct reverse labels against the real
hardware netlist.

```text
HD240BB-V6 actual netlist constraints:

MCU:
- STM32F410RBT6 LQFP64.
- HSE/LSE disabled. PH0/PH1 are NC; do not infer usable HSE.
- SWD: PA13/SWDIO, PA14/SWCLK.
- Internal HSI and HSI-sourced PLL are allowed. For current reverse evidence,
  RCC_PLLCFGR literal 0x07016410 decodes to HSI, PLLM=16, PLLN=400, PLLP=/4,
  PLLQ=7, SYSCLK=100MHz.

Communication:
- USART2 PA2/PA3 is the product communication path, not just debug.
- USART2 is used for Bluetooth transparent link, phone app, PC configuration,
  IO operations, and old-host replay.
- USART2 RX DMA circular, TX DMA normal.
- USART6/UART4/USART1 labels in reverse output are old-firmware paths or
  un-routed leftovers unless a later netlist proves otherwise.

SPI Flash / NVM:
- U13 W25Q128JVSIQTR.
- PA4=SPI_FLASH_CS, PA5=SPI1_SCK, PA6=SPI1_MISO, PA7=SPI1_MOSI.
- Used for parameters, backups, power-loss records, logs, calibration data,
  and staged IAP.

ADC:
- PA0=ADC1_IN0 current sensor.
- PA1=ADC1_IN1 voltage sense.
- PC5 must not be ADC1_IN15 in V6 output.

Outputs:
- PB13=FAN_EN, high active.
- PB14=HCL_PUMP, high active acid pump.
- PA10=WATER_PUMP_SWITCH, high-risk 220VAC water valve path.
- PA11=CORE_ONOFF, electrolysis core drive; TIM1_CH4-capable soft start path.
- PA12=LCD_BACKLIGHT.
- PC4=BUZZER, passive buzzer, high active.

Inputs / external IO:
- PC1=KEY_RUN/STOP.
- PC2=KEY_PRESSDOWN_10S.
- PC5=W_SENSOR digital input, high active.
- PB12=EXT_IN5.
- PB15=EXT_IN_COUNTER flow pulse input.
- PC8=EXT_IO3 presence input; default input.
- PC6=EXT-IO1_I2C4_SCL schematic net only; STM32F410 has no I2C4. Use as
  reserved open-drain GPIO / software I2C SCL.
- PC7=EXT-IO2_I2C4_SDA schematic net only; STM32F410 has no I2C4. Use as
  reserved open-drain GPIO / software I2C SDA.

LCD:
- GVH12832GFSL011-26480A, ST7565P.
- Board straps require 8-bit 8080-style parallel GPIO, not SPI.
- PB0..PB7=LCD_DB0..LCD_DB7, PB11=LCD_RD, PC10=LCD_RES, PC11=LCD_A0,
  PC12=LCD_WR, PA15=LCD_CS, PA12=LCD_BACKLIGHT.

Conflict rules:
- PC5 ADC1_IN15 or ETANK->PC5 is old-firmware conflict evidence. V6 mapping is
  PC5=W_SENSOR input, PA10=water valve, PA11=CORE_ONOFF.
- WPUMP/RpumpW maps to finite PA10 water-valve request.
- ETANK/RD maps to PA11 core state-machine start/stop, not PC5.
- HSE/HSEBYP helpers are old leftovers unless hardware routing changes.
```

