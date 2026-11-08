package com.wbdata;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
@ComponentScan(basePackages = {"com.wbdata"})
public class WbDataApplication {
    public static void main(String[] args) {
        SpringApplication.run(WbDataApplication.class, args);
    }
}
